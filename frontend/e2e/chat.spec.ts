import { expect, test } from '@playwright/test'
import { exchange, mockApi } from './mock-api'

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
  await page.goto('/')
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
