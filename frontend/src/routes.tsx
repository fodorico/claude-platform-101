import type { RouteObject } from 'react-router'
import { Layout } from './components/Layout'
import { ChatPage } from './pages/ChatPage'
import { NotFoundPage } from './pages/NotFoundPage'

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <ChatPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
