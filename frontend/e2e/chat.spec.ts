import { expect, test } from '@playwright/test'
import { CHAT_URL, exchange, mockApi } from './mock-api'

test('asks a suggested question and shows the formatted answer', async ({ page }) => {
  await mockApi(page, {
    answer: () => ({ reply: 'An API lets **programs** talk.\n\n- One\n- Two' }),
  })
  await page.goto('/')

  await page.getByRole('button', { name: 'Explain what an API is in two sentences' }).click()

  await expect(page.getByText('Explain what an API is in two sentences')).toBeVisible()
  await expect(page.locator('strong', { hasText: 'programs' })).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(2)
})

test('sends with Enter, clears the box and keeps the conversation in order', async ({ page }) => {
  await mockApi(page, {
    history: [exchange(1, 'First question', 'First answer')],
    answer: (prompt) => ({ reply: `Answer to ${prompt}` }),
  })
  await page.goto(CHAT_URL)
  const box = page.getByLabel('Message')

  await box.fill('Second question')
  await box.press('Enter')

  await expect(page.getByText('Answer to Second question')).toBeVisible()
  await expect(box).toHaveValue('')
  const texts = await page.getByText(/^(First|Second) question$/).allTextContents()
  expect(texts).toEqual(['First question', 'Second question'])
})

test('shows the error and keeps the message for a retry', async ({ page }) => {
  await mockApi(page, {
    answer: () => ({ error: 'Claude declined to answer this message', status: 422 }),
  })
  await page.goto('/')
  const box = page.getByLabel('Message')

  await box.fill('Something')
  await box.press('Enter')

  await expect(page.getByRole('alert')).toContainText('Claude declined to answer this message')
  await expect(box).toHaveValue('Something')
})

test('remembers the chosen theme', async ({ page }) => {
  await mockApi(page, { answer: () => ({ reply: 'ok' }) })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')

  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await page.reload()

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dim')
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible()
})

test('a new chat gets its own URL and a title in the history', async ({ page }) => {
  await mockApi(page, {
    history: [exchange(1, 'First question', 'First answer')],
    answer: (prompt) => ({ reply: `Answer to ${prompt}` }),
  })
  await page.goto('/')
  await expect(page.getByText(/No messages yet/)).toBeVisible()

  await page.getByLabel('Message').fill('Brand new topic')
  await page.getByLabel('Message').press('Enter')
  await expect(page.getByText('Answer to Brand new topic')).toBeVisible()
  await expect(page).toHaveURL(/\?chat=100$/)

  await page.getByRole('button', { name: 'History' }).click()
  const history = page.getByRole('complementary', { name: 'History' })
  await expect(history.getByRole('button', { name: 'Chat: Brand new topic' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(history.getByRole('button', { name: 'Earlier chat' })).toBeVisible()
})

test('sends to the model picked in the header', async ({ page }) => {
  await mockApi(page, { answer: () => ({ reply: 'ok' }) })
  await page.goto('/')
  const picker = page.getByLabel('Model')
  await expect(picker).toHaveValue('gemini:gemini-flash-lite-latest')
  await expect(picker.getByRole('option', { name: 'claude-opus-5-5' })).toBeDisabled()

  await picker.selectOption('gemini:gemini-flash-latest')
  const request = page.waitForRequest('**/api/messages/stream')
  await page.getByLabel('Message').fill('Hi')
  await page.getByLabel('Message').press('Enter')

  expect((await request).postDataJSON()).toMatchObject({
    provider: 'gemini',
    model: 'gemini-flash-latest',
  })
  await page.reload()
  await expect(page.getByLabel('Model')).toHaveValue('gemini:gemini-flash-latest')
})
