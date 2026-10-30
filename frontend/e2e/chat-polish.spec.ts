import { expect, test } from '@playwright/test'
import { CHAT_URL, exchange, mockApi } from './mock-api'

test('regenerates the last answer and edits the last question', async ({ page }) => {
  let answers = 0
  await mockApi(page, {
    history: [exchange(1, 'First question', 'First answer'), exchange(2, 'Second', 'Old answer')],
    answer: (prompt) => ({ reply: `Answer ${String(++answers)} to ${prompt}` }),
  })
  await page.goto(CHAT_URL)
  await expect(page.getByRole('heading', { name: 'Earlier chat' })).toBeVisible()

  await page.getByRole('button', { name: 'Regenerate answer' }).click()
  await expect(page.getByText('Answer 1 to Second')).toBeVisible()
  await expect(page.getByText('Old answer')).toHaveCount(0)

  await page.getByRole('button', { name: 'Edit question' }).click()
  const box = page.getByLabel('Message')
  await expect(box).toHaveValue('Second')
  await box.fill('Second, edited')
  await box.press('Enter')

  await expect(page.getByText('Answer 2 to Second, edited')).toBeVisible()
  await expect(page.getByText('Answer 1 to Second')).toHaveCount(0)
  await expect(page.getByText('First answer')).toBeVisible()
})

test('highlights code and copies it', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Clipboard permissions are Chromium-only')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockApi(page, {
    history: [exchange(1, 'Code', '```python\nprint("hi")  # greet\n```')],
    answer: () => ({ reply: 'ok' }),
  })
  await page.goto(CHAT_URL)

  await expect(page.locator('code.hljs .hljs-comment')).toHaveText('# greet')
  await page.getByRole('button', { name: 'Copy code' }).click()

  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('print("hi")  # greet\n')
})

test('searches the history', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('panels', JSON.stringify({ history: true, details: false }))
  })
  await mockApi(page, {
    history: [exchange(1, 'Hi', 'Hello')],
    answer: () => ({ reply: 'ok' }),
  })
  await page.goto('/')
  const history = page.getByRole('complementary', { name: 'History' })
  await expect(history.getByRole('button', { name: 'Earlier chat', exact: true })).toBeVisible()

  await history.getByRole('searchbox', { name: 'Search chats' }).fill('nothing like it')
  await expect(history.getByText('No chats match your search.')).toBeVisible()
  await history.getByRole('searchbox', { name: 'Search chats' }).fill('earlier')
  await expect(history.getByRole('button', { name: 'Earlier chat', exact: true })).toBeVisible()
})

test('opens the search and a new chat from the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Keyboard shortcuts are for desktop')
  await mockApi(page, {
    history: [exchange(1, 'Hi', 'Hello')],
    answer: () => ({ reply: 'ok' }),
  })
  await page.goto(CHAT_URL)
  await expect(page.getByText('Hello')).toBeVisible()

  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByRole('searchbox', { name: 'Search chats' })).toBeFocused()

  await page.keyboard.press('ControlOrMeta+Shift+O')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText('What would you like to know?')).toBeVisible()
})
