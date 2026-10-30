import { describe, expect, it } from 'vitest'
import type { ExchangeRead } from '../../api/generated/model'
import { activeExchanges, toTurns } from './versions'

const exchange = (id: number, group: number, isActive: boolean) =>
  ({ id, version_group: group, is_active: isActive }) as ExchangeRead

describe('versions', () => {
  it('groups the versions of each message and picks the active one', () => {
    const turns = toTurns([
      exchange(1, 1, true),
      exchange(2, 2, false),
      exchange(3, 2, true),
      exchange(4, 2, false),
    ])

    expect(turns.map((turn) => [turn.group, turn.active.id, turn.versions.length])).toEqual([
      [1, 1, 1],
      [2, 3, 3],
    ])
  })

  it('shows the latest version while none is active', () => {
    expect(toTurns([exchange(2, 2, false), exchange(3, 2, false)])[0]?.active.id).toBe(3)
  })

  it('lists the active exchanges as the context', () => {
    expect(
      activeExchanges([exchange(1, 1, true), exchange(2, 2, false), exchange(3, 2, true)]).map(
        (item) => item.id,
      ),
    ).toEqual([1, 3])
  })
})
