import { expect, test } from '@playwright/test'
import { exchange, mockApi } from './mock-api'

test('opens both panels and shows the details of the picked answer', async ({ page, isMobile }) => {
  test.skip(isMobile, 'On phones the panels are drawers; covered below.')
  await mockApi(page, {
    history: [
      exchange(2, 'Second question', 'Second answer'),
      exchange(1, 'First question', 'First answer'),
    ],
    answer: () => ({ reply: 'ok' }),
  })
  await page.goto('/')
  await expect(page.getByText('Second answer')).toBeVisible()

  await page.getByRole('button', { name: 'History' }).click()
  await page.getByRole('button', { name: 'Request details', exact: true }).click()
  const details = page.getByRole('complementary', { name: 'Request details' })
  await expect(details.getByText('1.2 s')).toBeVisible()
  await expect(details.getByText('Answer briefly.')).toBeVisible()

  await page
    .getByRole('complementary', { name: 'History' })
    .getByRole('button', { name: 'First question' })
    .click()
  await expect(details.getByText('“First question”')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('complementary', { name: 'History' })).toBeVisible()
  await expect(details).toBeVisible()
})

test('history is a drawer on phones that closes after picking', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone layout only.')
  await mockApi(page, {
    history: [exchange(1, 'First question', 'First answer')],
    answer: () => ({ reply: 'ok' }),
  })
  await page.goto('/')

  await page.getByRole('button', { name: 'History' }).click()
  const drawer = page.getByRole('complementary', { name: 'History' })
  await drawer.getByRole('button', { name: 'First question' }).click()

  await expect(drawer).toBeHidden()
  await expect(page.getByText('First answer')).toBeVisible()
})
