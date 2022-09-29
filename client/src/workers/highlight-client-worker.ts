import {
	AsyncEventsMessage,
	FeedbackMessage,
	HighlightClientWorkerParams,
	HighlightClientWorkerResponse,
	IdentifyMessage,
	MessageType,
	MetricsMessage,
	PropertiesMessage,
} from './types'
import stringify from 'json-stringify-safe'
import {
	getSdk,
	PushPayloadMutationVariables,
	Sdk,
} from '../graph/generated/operations'
import { ReplayEventsInput } from '../graph/generated/schemas'
import { GraphQLClient } from 'graphql-request'
import { getGraphQLRequestWrapper } from '../utils/graph'
import {
	MAX_PUBLIC_GRAPH_RETRY_ATTEMPTS,
	NON_SERIALIZABLE_PROPS,
	PROPERTY_MAX_LENGTH,
} from './constants'
import { Logger } from '../logger'

export interface HighlightClientRequestWorker {
	postMessage: (message: HighlightClientWorkerParams) => void
	onmessage: (message: MessageEvent<HighlightClientWorkerResponse>) => void
}

interface HighlightClientResponseWorker {
	onmessage:
		| null
		| ((message: MessageEvent<HighlightClientWorkerParams>) => void)

	postMessage(e: HighlightClientWorkerResponse): void
}

// `as any` because: https://github.com/Microsoft/TypeScript/issues/20595
const worker: HighlightClientResponseWorker = self as any

function stringifyProperties(
	properties_object: any,
	type: 'session' | 'track' | 'user',
) {
	const stringifiedObj: any = {}
	const invalidTypes: any[] = []
	const tooLong: any[] = []
	for (const [key, value] of Object.entries(properties_object)) {
		if (value === undefined || value === null) {
			continue
		}

		if (!NON_SERIALIZABLE_PROPS.includes(typeof value)) {
			invalidTypes.push({ [key]: value })
		}
		let asString: string
		if (typeof value === 'string') {
			asString = value
		} else {
			asString = stringify(value)
		}
		if (asString.length > PROPERTY_MAX_LENGTH) {
			tooLong.push({ [key]: value })
			asString = asString.substring(0, PROPERTY_MAX_LENGTH)
		}

		stringifiedObj[key] = asString
	}

	// Skipping logging for 'session' type because they're generated by Highlight
	// (e.g. visited-url > 2000 characters)
	if (type !== 'session') {
		if (invalidTypes.length > 0) {
			console.warn(
				`Highlight was passed one or more ${type} properties not of type string, number, or boolean.`,
				invalidTypes,
			)
		}

		if (tooLong.length > 0) {
			console.warn(
				`Highlight was passed one or more ${type} properties exceeding 2000 characters, which will be truncated.`,
				tooLong,
			)
		}
	}

	return stringifiedObj
}

{
	let graphqlSDK: Sdk
	let backend: string
	let sessionSecureID: string
	let numberOfFailedRequests: number = 0
	let debug: boolean = false
	let recordingStartTime: number = 0
	let logger = new Logger(false, '[worker]')

	const shouldSendRequest = (): boolean => {
		return (
			recordingStartTime !== 0 &&
			numberOfFailedRequests < MAX_PUBLIC_GRAPH_RETRY_ATTEMPTS &&
			!!sessionSecureID?.length
		)
	}

	const addCustomEvent = <T>(tag: string, payload: T) => {
		worker.postMessage({
			response: {
				type: MessageType.CustomEvent,
				tag: tag,
				payload: payload,
			},
		})
	}

	const processAsyncEventsMessage = async (msg: AsyncEventsMessage) => {
		const {
			id,
			events,
			messages,
			errors,
			resourcesString,
			isBeacon,
			hasSessionUnloaded,
			highlightLogs,
		} = msg

		const messagesString = stringify({ messages: messages })
		let payload: PushPayloadMutationVariables = {
			session_secure_id: sessionSecureID,
			events: { events } as ReplayEventsInput,
			messages: messagesString,
			resources: resourcesString,
			errors,
			is_beacon: isBeacon,
			has_session_unloaded: hasSessionUnloaded,
			payload_id: id.toString(),
		}
		if (highlightLogs) {
			payload.highlight_logs = highlightLogs
		}

		const eventsSize = await graphqlSDK
			.PushPayload(payload)
			.then((res) => res.pushPayload ?? 0)

		worker.postMessage({
			response: { type: MessageType.AsyncEvents, id, eventsSize },
		})
	}

	const processIdentifyMessage = async (msg: IdentifyMessage) => {
		const { userObject, userIdentifier, source } = msg
		if (source === 'segment') {
			addCustomEvent(
				'Segment Identify',
				stringify({ userIdentifier, ...userObject }),
			)
		} else {
			addCustomEvent(
				'Identify',
				stringify({ userIdentifier, ...userObject }),
			)
		}
		await graphqlSDK.identifySession({
			session_secure_id: sessionSecureID,
			user_identifier: userIdentifier,
			user_object: stringifyProperties(userObject, 'user'),
		})
		const sourceString = source === 'segment' ? source : 'default'
		logger.log(
			`Identify (${userIdentifier}, source: ${sourceString}) w/ obj: ${stringify(
				userObject,
			)} @ ${backend}`,
		)
	}

	const processPropertiesMessage = async (msg: PropertiesMessage) => {
		const { propertiesObject, propertyType } = msg
		// Session properties are custom properties that the Highlight snippet adds (visited-url, referrer, etc.)
		if (propertyType?.type === 'session') {
			await graphqlSDK.addSessionProperties({
				session_secure_id: sessionSecureID,
				properties_object: stringifyProperties(
					propertiesObject,
					'session',
				),
			})
			logger.log(
				`AddSessionProperties to session (${sessionSecureID}) w/ obj: ${JSON.stringify(
					propertiesObject,
				)} @ ${backend}`,
			)
		}
		// Track properties are properties that users define; rn, either through segment or manually.
		else {
			if (propertyType?.source === 'segment') {
				addCustomEvent<string>(
					'Segment Track',
					stringify(propertiesObject),
				)
			} else {
				addCustomEvent<string>('Track', stringify(propertiesObject))
			}
		}
	}

	const processMetricsMessage = async (msg: MetricsMessage) => {
		await graphqlSDK.pushMetrics({
			metrics: msg.metrics.map((m) => ({
				name: m.name,
				value: m.value,
				session_secure_id: sessionSecureID,
				category: m.category,
				group: m.group,
				timestamp: m.timestamp.toISOString(),
				tags: m.tags,
			})),
		})
	}

	const processFeedbackMessage = async (msg: FeedbackMessage) => {
		const { timestamp, verbatim, userEmail, userName } = msg
		await graphqlSDK.addSessionFeedback({
			session_secure_id: sessionSecureID,
			timestamp,
			verbatim,
			user_email: userEmail,
			user_name: userName,
		})
	}

	worker.onmessage = async function (e) {
		if (e.data.message.type === MessageType.Initialize) {
			backend = e.data.message.backend
			sessionSecureID = e.data.message.sessionSecureID
			debug = e.data.message.debug
			recordingStartTime = e.data.message.recordingStartTime
			logger.debug = debug
			graphqlSDK = getSdk(
				new GraphQLClient(backend, {
					headers: {},
				}),
				getGraphQLRequestWrapper(sessionSecureID),
			)
			return
		}
		if (!shouldSendRequest()) {
			return
		}
		try {
			if (e.data.message.type === MessageType.AsyncEvents) {
				await processAsyncEventsMessage(
					e.data.message as AsyncEventsMessage,
				)
			} else if (e.data.message.type === MessageType.Identify) {
				await processIdentifyMessage(e.data.message as IdentifyMessage)
			} else if (e.data.message.type === MessageType.Properties) {
				await processPropertiesMessage(
					e.data.message as PropertiesMessage,
				)
			} else if (e.data.message.type === MessageType.Metrics) {
				await processMetricsMessage(e.data.message as MetricsMessage)
			} else if (e.data.message.type === MessageType.Feedback) {
				await processFeedbackMessage(e.data.message as FeedbackMessage)
			}
			numberOfFailedRequests = 0
		} catch (e) {
			if (debug) {
				console.error(e)
			}
			numberOfFailedRequests += 1
		}
	}
}
