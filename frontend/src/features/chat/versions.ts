import type { ExchangeRead } from '../../api/generated/model'

/** One message of the chat with every version of it (regenerated or edited). */
export interface Turn {
  group: number
  /** The version the chat continues from. */
  active: ExchangeRead
  /** Oldest first. */
  versions: ExchangeRead[]
}

/** The chat's messages in order, each with its versions; a message whose versions are all
 * inactive (only while a new version is being written) shows its latest one. */
export function toTurns(exchanges: ExchangeRead[]): Turn[] {
  const groups = new Map<number, ExchangeRead[]>()
  for (const exchange of exchanges) {
    groups.set(exchange.version_group, [...(groups.get(exchange.version_group) ?? []), exchange])
  }
  return [...groups].map(([group, versions]) => ({
    group,
    versions,
    active: versions.find((item) => item.is_active) ?? (versions.at(-1) as ExchangeRead),
  }))
}

/** The answers the chat continues from (its context), oldest first. */
export function activeExchanges(exchanges: ExchangeRead[]): ExchangeRead[] {
  return toTurns(exchanges).map((turn) => turn.active)
}
