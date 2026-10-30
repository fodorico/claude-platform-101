import { expect, test } from '@playwright/test'
import { exchange, mockApi } from './mock-api'

test('renames, archives and deletes chats from the history', async ({ page }) => {
  await mockApi(page, {
    history: [exchange(1, 'First question', 'First answer')],
    answer: () => ({ reply: 'ok' }),
  })
  await page.goto('/')
  for (const prompt of ['Second chat', 'Third chat']) {
    await page.getByLabel('Message').fill(prompt)
    await page.getByLabel('Message').press('Enter')
    await expect(page.getByText('ok').last()).toBeVisible()
    await page.goto('/')
  }

  await page.getByRole('button', { name: 'History' }).click()
  const history = page.getByRole('complementary', { name: 'History' })

  await history.getByRole('button', { name: 'Options for Earlier chat' }).click()
  await history.getByRole('button', { name: 'Rename' }).click()
  await history.getByLabel('Chat title').fill('Renamed chat')
  await history.getByLabel('Chat title').press('Enter')
  await expect(history.getByRole('button', { name: 'Renamed chat', exact: true })).toBeVisible()

  await history.getByRole('button', { name: 'Select' }).click()
  await history.getByRole('checkbox', { name: 'Chat: Second chat' }).check()
  await history.getByRole('checkbox', { name: 'Chat: Third chat' }).check()
  await history.getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(history.getByRole('button', { name: 'Chat: Second chat', exact: true })).toBeHidden()

  await history.getByRole('button', { name: 'Archived' }).click()
  await expect(history.getByRole('button', { name: 'Chat: Third chat', exact: true })).toBeVisible()
  await history.getByRole('button', { name: 'Select' }).click()
  await history.getByRole('checkbox', { name: 'Select all' }).check()
  await history.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete 2 chats?' })
  await dialog.getByRole('button', { name: 'Delete' }).click()

  await expect(history.getByText('No archived chats.')).toBeVisible()
  await history.getByRole('button', { name: 'Chats', exact: true }).click()
  await expect(history.getByRole('button', { name: 'Renamed chat', exact: true })).toBeVisible()
})
