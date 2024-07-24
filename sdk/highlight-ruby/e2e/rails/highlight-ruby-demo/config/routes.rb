Rails.application.routes.draw do
  get 'pages/home'
  resources :articles, only: [:index, :new]
  resources :traces, only: [:create] do
    post :custom_project_id, on: :collection
  end
  resources :logs, only: [:create]
  resources :errors, only: [:create]

  root to: "pages#home"
end
