'use client'

import { motion } from 'framer-motion'

/**
 * Enter animation for a panel body.
 *
 * This deliberately sits *inside* each role's panel module rather than in the shell.
 * Keying the transition in the shell would remount the whole module on every section
 * change — discarding the pharmacist's badge counts and the delivery order list, and
 * refetching both. Here only the body below it is replaced; the module holding the state
 * stays mounted.
 */
export default function PanelTransition({
  sectionId,
  children,
}: {
  sectionId: string
  children: React.ReactNode
}) {
  return (
    <motion.div
      key={sectionId}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}
