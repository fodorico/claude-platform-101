import { motion } from 'motion/react'
import type { ExchangeRead } from '../../api/generated/model'

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

export function ExchangeCard({ exchange }: { exchange: ExchangeRead }) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="card bg-base-100 shadow-sm"
    >
      <div className="card-body gap-3">
        <p className="font-medium whitespace-pre-wrap">{exchange.prompt}</p>
        <p className="whitespace-pre-wrap text-base-content/80">{exchange.reply}</p>
        <p className="text-xs text-base-content/50">
          {exchange.model} · {dateFormat.format(new Date(exchange.created_at))}
        </p>
      </div>
    </motion.article>
  )
}
