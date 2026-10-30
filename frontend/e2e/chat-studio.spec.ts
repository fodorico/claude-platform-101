import { expect, test } from '@playwright/test'
import { CHAT_URL, exchange, mockApi } from './mock-api'

test('starts a chat with a system prompt and shows the reasoning', async ({ page }) => {
  await mockApi(page, { answer: (prompt) => ({ reply: `Answer to ${prompt}` }) })
  await page.goto('/')

  await page.getByRole('button', { name: 'Chat settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Chat settings' })
  await dialog.getByLabel('System prompt').fill('Answer like a pirate.')
  await dialog.getByLabel(/Show reasoning/).check()
  const request = page.waitForRequest('**/api/messages/stream')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await page.getByLabel('Message').fill('What is an API?')
  await page.getByLabel('Message').press('Enter')

  expect((await request).postDataJSON()).toMatchObject({
    settings: { system_prompt: 'Answer like a pirate.', show_thinking: true },
  })
  await expect(page.getByText('Answer to What is an API?')).toBeVisible()
  await page.getByRole('button', { name: 'Reasoning' }).click()
  await expect(page.getByText('First, recall what an API is.')).toBeVisible()
})

test('keeps versions of a regenerated answer and compares them', async ({ page }) => {
  let answers = 0
  await mockApi(page, {
    history: [exchange(1, 'Explain APIs', 'First take')],
    answer: () => ({ reply: `Take ${String(++answers + 1)}` }),
  })
  await page.goto(CHAT_URL)

  await page.getByRole('button', { name: 'Regenerate answer' }).click()
  await expect(page.getByText('Take 2')).toBeVisible()
  const versions = page.getByRole('group', { name: 'Versions' })
  await expect(versions).toContainText('2 / 2')

  await versions.getByRole('button', { name: 'Previous version' }).click()
  await expect(page.getByText('First take')).toBeVisible()
  await expect(page.getByText('Take 2')).toHaveCount(0)

  await versions.getByRole('button', { name: 'Compare versions' }).click()
  const compare = page.getByRole('dialog', { name: 'Compare versions' })
  await expect(compare.getByRole('article')).toHaveCount(2)
})

test('saves a prompt, inserts it and counts its tokens', async ({ page }) => {
  await mockApi(page, { answer: () => ({ reply: 'ok' }) })
  await page.goto('/')

  await page.getByRole('button', { name: 'Prompt library' }).click()
  const dialog = page.getByRole('dialog', { name: 'Prompt library' })
  await dialog.getByRole('button', { name: 'New prompt' }).click()
  await dialog.getByLabel('Title').fill('Explain simply')
  await dialog.getByLabel('Prompt').fill('Explain it to a ten year old')
  await dialog.getByRole('button', { name: 'Save prompt' }).click()
  await dialog.getByRole('button', { name: /^Explain simply/ }).click()

  await expect(page.getByLabel('Message')).toHaveValue('Explain it to a ten year old')
  await expect(page.getByText('≈ 21 input tokens')).toBeVisible()
})

test('attaches an image to a message', async ({ page }) => {
  await mockApi(page, { answer: () => ({ reply: 'A cat.' }) })
  await page.goto('/')

  await page.locator('input[type=file]').setInputFiles({
    name: 'cat.png',
    mimeType: 'image/png',
    // A 1×1 transparent PNG.
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    ),
  })
  await expect(page.getByRole('img', { name: 'cat.png' })).toBeVisible()
  const request = page.waitForRequest('**/api/messages/stream')
  await page.getByLabel('Message').fill('What is this?')
  await page.getByLabel('Message').press('Enter')

  const body = (await request).postDataJSON() as { images: { media_type: string }[] }
  expect(body.images.map((image) => image.media_type)).toEqual(['image/png'])
  await expect(page.getByText('A cat.')).toBeVisible()
})

test('shows the cost and the API call in the details panel', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('panels', JSON.stringify({ history: false, details: true }))
  })
  await mockApi(page, {
    history: [exchange(1, 'Hi', 'Hello')],
    answer: () => ({ reply: 'ok' }),
  })
  await page.goto(CHAT_URL)
  const details = page.getByRole('complementary', { name: 'Request details' })

  await expect(details.getByText('Estimated cost').first()).toBeVisible()
  await details.getByRole('button', { name: 'View API call' }).click()

  const dialog = page.getByRole('dialog', { name: 'API call' })
  await expect(dialog.getByRole('region', { name: 'Request' })).toContainText(
    '"system_instruction": "Answer briefly."',
  )
})
