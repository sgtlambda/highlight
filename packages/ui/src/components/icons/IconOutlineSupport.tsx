import React from 'react'

import { IconProps } from './types'

export const IconOutlineSupport = ({ size = '1em', ...props }: IconProps) => {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width={size}
			height={size}
			fill="none"
			viewBox="0 0 24 24"
			focusable="false"
			{...props}
		>
			<path
				fill="currentColor"
				fillRule="evenodd"
				d="M5.68 7.094A7.965 7.965 0 0 0 4 12c0 1.849.627 3.551 1.68 4.906l2.148-2.149A4.977 4.977 0 0 1 7 12c0-1.02.305-1.967.828-2.757L5.68 7.094ZM7.094 5.68l2.149 2.148A4.977 4.977 0 0 1 12 7c1.02 0 1.967.305 2.757.828l2.149-2.148A7.965 7.965 0 0 0 12 4a7.965 7.965 0 0 0-4.906 1.68ZM18.32 7.094l-2.148 2.149c.523.79.828 1.738.828 2.757 0 1.02-.305 1.967-.828 2.757l2.148 2.149A7.965 7.965 0 0 0 20 12a7.966 7.966 0 0 0-1.68-4.906ZM16.906 18.32l-2.149-2.148A4.977 4.977 0 0 1 12 17a4.977 4.977 0 0 1-2.757-.828L7.094 18.32A7.966 7.966 0 0 0 12 20a7.965 7.965 0 0 0 4.906-1.68ZM2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10S2 17.523 2 12Zm7 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z"
				clipRule="evenodd"
			/>
		</svg>
	)
}
