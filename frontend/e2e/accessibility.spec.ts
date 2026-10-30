import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { CHAT_URL, exchange, mockApi } from './mock-api'

// WCAG 2.2 A and AA rules, checked on every screen state in both themes.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  const summary = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help} — ${violation.nodes
        .map((node) => `${node.target.join(' ')} ${node.html.slice(0, 120)}`)
        .join(', ')}`,
  )
  expect(summary).toEqual([])
}

for (const theme of ['nord', 'dim'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => {
        localStorage.setItem('theme', value)
      }, theme)
    })

    test('empty state has no accessibility violations', async ({ page }) => {
      await mockApi(page, { answer: () => ({ reply: 'ok' }) })
      await page.goto('/')
      await expect(page.getByText('What would you like to know?')).toBeVisible()

      await expectNoViolations(page)
    })

    test('conversation has no accessibility violations', async ({ page }) => {
      await mockApi(page, {
        history: [
          exchange(1, 'What is an API?', 'An API is:\n\n- a contract\n- with `endpoints`'),
          exchange(2, 'And in one line?', 'A contract between **programs**.'),
        ],
        answer: () => ({ reply: 'ok' }),
      })
      await page.goto(CHAT_URL)
      await expect(page.getByText('A contract between')).toBeVisible()

      await expectNoViolations(page)
    })

    test('open side panels have no accessibility violations', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('panels', JSON.stringify({ history: true, details: true }))
      })
      await mockApi(page, {
        history: [exchange(1, 'What is an API?', 'A contract between **programs**.')],
        answer: () => ({ reply: 'ok' }),
      })
      await page.goto(CHAT_URL)
      await expect(page.getByText('Answer briefly.')).toBeVisible()

      await expectNoViolations(page)
    })

    test('chat options, selection and delete dialog have no accessibility violations', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        localStorage.setItem('panels', JSON.stringify({ history: true, details: false }))
      })
      await mockApi(page, {
        history: [exchange(1, 'What is an API?', 'A contract between **programs**.')],
        answer: () => ({ reply: 'ok' }),
      })
      await page.goto('/')
      const history = page.getByRole('complementary', { name: 'History' })

      await history.getByRole('button', { name: 'Options for Earlier chat' }).click()
      await expect(history.getByRole('button', { name: 'Rename' })).toBeVisible()
      await expectNoViolations(page)

      await history.getByRole('button', { name: 'Select' }).click()
      await history.getByRole('checkbox', { name: 'Earlier chat' }).check()
      await expectNoViolations(page)

      await history.getByRole('button', { name: 'Delete' }).click()
      await expect(page.getByRole('alertdialog')).toBeVisible()
      await expectNoViolations(page)
    })

    test('code blocks, edit mode and the shortcuts dialog have no accessibility violations', async ({
      page,
      isMobile,
    }) => {
      // On a phone the panels are drawers over the chat, so they stay closed here.
      await page.addInitScript((open) => {
        localStorage.setItem('panels', JSON.stringify({ history: open, details: open }))
      }, !isMobile)
      await mockApi(page, {
        history: [
          exchange(
            1,
            'Show code',
            'Here:\n\n```python\ndef add(a, b):\n    return a + b  # sum\n```',
          ),
          exchange(2, 'Again', 'Some `inline` code.'),
        ],
        answer: () => ({ reply: 'ok' }),
      })
      await page.goto(CHAT_URL)
      await expect(page.getByRole('button', { name: 'Copy code' })).toBeVisible()
      await page.getByRole('button', { name: 'Edit question' }).click()
      await expect(page.getByText('Editing your last message')).toBeVisible()

      await expectNoViolations(page)

      if (!isMobile) {
        await page.getByRole('button', { name: 'Keyboard shortcuts' }).click()
        await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
        await expectNoViolations(page)
      }
    })

    test('error state has no accessibility violations', async ({ page }) => {
      await mockApi(page, { answer: () => ({ error: 'Rate limit reached', status: 429 }) })
      await page.goto('/')
      await page.getByLabel('Message').fill('Hi')
      await page.getByLabel('Message').press('Enter')
      await expect(page.getByRole('alert')).toBeVisible()

      await expectNoViolations(page)
    })
  })
}
