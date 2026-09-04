'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { CheckCircle2, ChevronLeft, Loader2, MessageSquare, X } from 'lucide-react'
import { fmtBDT } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

// ---------- bKash demo payment simulation ----------
// 4-phase state machine: wallet number → OTP → confirm & PIN → processing → success.
// Purely front-end: on success the parent's onPaid() places the real order, and the
// backend marks the Payment PAID with a BKASH-DEMO transaction id.

type BkashStep = 'wallet' | 'otp' | 'pin' | 'processing' | 'success'

const WALLET_RE = /^01[3-9]\d{8}$/
const DEMO_OTP = '12345'
const OTP_LENGTH = 5
const RESEND_SECONDS = 30
const PROCESS_LINES = ['Contacting bKash…', 'Authorizing payment…']

const TXN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
function randomTxnId(): string {
  let out = 'Bk'
  for (let i = 0; i < 8; i++) {
    out += TXN_CHARS[Math.floor(Math.random() * TXN_CHARS.length)]
  }
  return out
}

function formatWallet(digits: string): string {
  const d = digits.slice(0, 11)
  let out = d.slice(0, 5)
  if (d.length > 5) out += ` ${d.slice(5, 8)}`
  if (d.length > 8) out += ` ${d.slice(8, 11)}`
  return out
}

interface BkashPayDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  amount: number
  onPaid: () => void
}

export default function BkashPayDialog({ open, onOpenChange, amount, onPaid }: BkashPayDialogProps) {
  const [step, setStep] = useState<BkashStep>('wallet')
  const [dir, setDir] = useState<1 | -1>(1)

  const [wallet, setWallet] = useState('') // digits only, max 11
  const [walletTouched, setWalletTouched] = useState(false)

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [otpError, setOtpError] = useState<string | null>(null)
  const [resendSecs, setResendSecs] = useState(RESEND_SECONDS)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])
  const shake = useAnimationControls()

  const [pin, setPin] = useState('')
  const [statusIdx, setStatusIdx] = useState(0)
  const [txnId, setTxnId] = useState<string | null>(null)

  // Hand-off latch. The success effect must fire exactly once per open cycle: it closes
  // the dialog and places the real order, and a second run would place a duplicate.
  const paidRef = useRef(false)

  // The parent passes `onPaid` as an inline arrow, so its identity changes on every
  // parent render — and placing an order re-renders the parent. Reading the callbacks
  // from refs keeps the success effect keyed on `step` alone, so a parent re-render
  // can never cancel and re-arm the timer.
  const onPaidRef = useRef(onPaid)
  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => {
    onPaidRef.current = onPaid
    onOpenChangeRef.current = onOpenChange
  })

  const walletValid = WALLET_RE.test(wallet)
  const locked = step === 'processing' || step === 'success'
  const isInputStep = step === 'wallet' || step === 'otp' || step === 'pin'
  const stepIdx = step === 'wallet' ? 1 : step === 'otp' ? 2 : 3

  // reset the flow whenever the dialog opens (render-phase prop adjustment —
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setStep('wallet')
      setDir(1)
      setOtpError(null)
      setPin('')
      setStatusIdx(0)
      setTxnId(null)
      setResendSecs(RESEND_SECONDS)
    }
  }

  // Arm a fresh hand-off each time the dialog opens. This lives in an effect rather
  // than the render-phase reset above because refs must not be written during render.
  // Safe ordering: opening also sets step to 'wallet', so the success effect below
  // cannot fire before this has run.
  useEffect(() => {
    if (open) paidRef.current = false
  }, [open])

  // resend countdown ticks while on the OTP step (timer value is set by the
  // navigation events that enter this step, not by this effect)
  useEffect(() => {
    if (step !== 'otp') return
    const iv = setInterval(() => {
      setResendSecs((s) => (s <= 1 ? 0 : s - 1))
    }, 1000)
    return () => clearInterval(iv)
  }, [step])

  // processing → rotating status lines → success
  useEffect(() => {
    if (step !== 'processing') return
    const t1 = setTimeout(() => setStatusIdx(1), 800)
    const t2 = setTimeout(() => {
      setTxnId(randomTxnId())
      setStep('success')
    }, 1600)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [step])

  // success → let the user see it, then close and hand off to the real order placement.
  // Guarded by paidRef: the dialog stays mounted after it closes with step still
  // 'success', so without the latch every later render would re-place the order.
  useEffect(() => {
    if (step !== 'success' || paidRef.current) return
    const t = setTimeout(() => {
      paidRef.current = true
      onOpenChangeRef.current(false)
      onPaidRef.current()
    }, 950)
    return () => clearTimeout(t)
  }, [step])

  const goTo = (next: BkashStep, direction: 1 | -1 = 1) => {
    setDir(direction)
    setStep(next)
    if (next === 'otp') {
      // fresh 30s resend window every time the OTP step is (re)entered
      setResendSecs(RESEND_SECONDS)
      // wait for the AnimatePresence exit (~180ms) before focusing the new input
      setTimeout(() => otpRefs.current[0]?.focus(), 280)
    }
  }

  const goBack = () => {
    if (step === 'otp') goTo('wallet', -1)
    else if (step === 'pin') goTo('otp', -1)
  }

  const resendCode = () => {
    setResendSecs(RESEND_SECONDS)
    setOtp(Array(OTP_LENGTH).fill(''))
    setOtpError(null)
    otpRefs.current[0]?.focus()
  }

  const verifyOtp = () => {
    const code = otp.join('')
    if (code.length < OTP_LENGTH) return
    if (code === DEMO_OTP) {
      setOtpError(null)
      goTo('pin')
    } else {
      setOtpError('Invalid verification code. Please check and try again.')
      void shake.start({
        x: [0, -8, 8, -6, 6, -3, 0],
        transition: { duration: 0.35 },
      })
    }
  }

  const confirmPay = () => {
    if (pin.length < 4 || !walletValid) return
    setOtpError(null)
    setStatusIdx(0)
    goTo('processing')
  }

  const handleOtpChange = (i: number, raw: string) => {
    const digit = raw.replace(/\D/g, '').slice(-1)
    setOtp((prev) => {
      const next = [...prev]
      next[i] = digit
      return next
    })
    if (digit && i < OTP_LENGTH - 1) otpRefs.current[i + 1]?.focus()
  }

  const handleOtpKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) {
      e.preventDefault()
      setOtp((prev) => {
        const next = [...prev]
        next[i - 1] = ''
        return next
      })
      otpRefs.current[i - 1]?.focus()
    }
  }

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
    if (!digits) return
    const next = Array(OTP_LENGTH).fill('')
    digits.split('').forEach((d, i) => {
      next[i] = d
    })
    setOtp(next)
    otpRefs.current[Math.min(digits.length, OTP_LENGTH - 1)]?.focus()
  }

  const showWalletError = wallet.length > 0 && !walletValid && (walletTouched || wallet.length === 11)

  const slide = {
    initial: { opacity: 0, x: 24 * dir },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -24 * dir },
    transition: { duration: 0.18, ease: 'easeOut' as const },
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !locked && onOpenChange(o)}>
      <DialogContent
        className="max-w-sm gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-sm"
        showCloseButton={false}
        onEscapeKeyDown={(e) => {
          if (locked) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          if (locked) e.preventDefault()
        }}
        // keep the payment dialog open when focus drifts to the page behind it
        // (step transitions unmount the focused element; aborting a payment
        // because of a focus blip would be hostile UX)
        onFocusOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">bKash payment</DialogTitle>
        <DialogDescription className="sr-only">
          Demo bKash payment of {fmtBDT(amount)} for your MediPlus order
        </DialogDescription>

        {/* ---------- Pink brand header ---------- */}
        <div className="bg-gradient-to-r from-[#E2136E] to-[#d10a62] px-4 pb-3 pt-3 text-white">
          <div className="relative flex items-center justify-center">
            {step === 'otp' || step === 'pin' ? (
              <button
                type="button"
                aria-label="Go back"
                onClick={goBack}
                className="absolute left-0 flex size-9 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15"
              >
                <ChevronLeft className="size-5" aria-hidden="true" />
              </button>
            ) : null}

            <div className="flex items-baseline gap-2">
              <span className="text-xl font-extrabold tracking-tight">
                <span className="font-black">b</span>Kash
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/85">
                Payment
              </span>
            </div>

            <button
              type="button"
              aria-label="Close payment dialog"
              disabled={locked}
              onClick={() => onOpenChange(false)}
              className="absolute right-0 flex size-9 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 disabled:pointer-events-none disabled:opacity-40"
            >
              <X className="size-4.5" aria-hidden="true" />
            </button>
          </div>

          {isInputStep ? (
            <div className="mt-2.5 flex items-center gap-2">
              <div className="flex flex-1 gap-1.5">
                {[1, 2, 3].map((n) => (
                  <span
                    key={n}
                    className={cn(
                      'h-1 flex-1 rounded-full transition-colors duration-200',
                      n <= stepIdx ? 'bg-white' : 'bg-white/30'
                    )}
                  />
                ))}
              </div>
              <span className="text-[10px] font-medium text-white/85">Step {stepIdx} of 3</span>
            </div>
          ) : null}
        </div>

        {/* ---------- Body ---------- */}
        <div className="min-h-[264px] p-4">
          <AnimatePresence mode="wait" initial={false}>
            {/* ----- Step 1: wallet number ----- */}
            {step === 'wallet' && (
              <motion.div key="wallet" {...slide} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="bkash-wallet">Your bKash account number</Label>
                  <Input
                    id="bkash-wallet"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    autoFocus
                    placeholder="01XXX XXXXX"
                    aria-invalid={showWalletError}
                    value={formatWallet(wallet)}
                    onChange={(e) => setWallet(e.target.value.replace(/\D/g, '').slice(0, 11))}
                    onBlur={() => setWalletTouched(true)}
                    className={cn(
                      'h-11 text-base tracking-wide',
                      showWalletError && 'border-destructive'
                    )}
                  />
                  {showWalletError ? (
                    <p className="text-xs font-medium text-destructive" role="alert">
                      Enter a valid bKash number — 11 digits starting with 01.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Demo: any valid BD number works, e.g.{' '}
                      <span className="font-mono">01811 234 567</span>
                    </p>
                  )}
                </div>
                <Button
                  className="h-11 w-full rounded-xl"
                  disabled={!walletValid}
                  onClick={() => goTo('otp')}
                >
                  Continue
                </Button>
              </motion.div>
            )}

            {/* ----- Step 2: OTP verification ----- */}
            {step === 'otp' && (
              <motion.div key="otp" {...slide} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  We sent a {OTP_LENGTH}-digit code to{' '}
                  <span className="font-semibold text-foreground">{formatWallet(wallet)}</span>
                </p>

                <div className="flex items-start gap-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  <MessageSquare className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    Demo OTP: <span className="font-mono font-bold">12345</span> (in production this
                    arrives by SMS)
                  </span>
                </div>

                <div className="space-y-2">
                  <motion.div animate={shake} className="flex justify-between gap-2">
                    {otp.map((d, i) => (
                      <Input
                        key={i}
                        ref={(el) => {
                          otpRefs.current[i] = el
                        }}
                        value={d}
                        onChange={(e) => handleOtpChange(i, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(i, e)}
                        onPaste={handleOtpPaste}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={1}
                        aria-label={`OTP digit ${i + 1}`}
                        aria-invalid={!!otpError}
                        className="h-12 w-12 rounded-lg p-0 text-center text-lg font-bold"
                      />
                    ))}
                  </motion.div>
                  {otpError && (
                    <p className="text-xs font-medium text-destructive" role="alert">
                      {otpError}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Didn&apos;t get the code?</p>
                  <button
                    type="button"
                    disabled={resendSecs > 0}
                    onClick={resendCode}
                    className="text-xs font-semibold text-[#E2136E] transition-opacity hover:underline disabled:no-underline disabled:opacity-50 dark:text-[#f04c97]"
                  >
                    {resendSecs > 0 ? `Resend code (${resendSecs}s)` : 'Resend code'}
                  </button>
                </div>

                <Button
                  className="h-11 w-full rounded-xl"
                  disabled={otp.join('').length < OTP_LENGTH}
                  onClick={verifyOtp}
                >
                  Verify &amp; Continue
                </Button>
              </motion.div>
            )}

            {/* ----- Step 3: confirm & PIN ----- */}
            {step === 'pin' && (
              <motion.div key="pin" {...slide} className="space-y-4">
                <div className="rounded-xl border bg-muted/40 p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Merchant</span>
                    <span className="font-semibold">MediPlus</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-muted-foreground">Wallet</span>
                    <span className="font-mono font-medium">{formatWallet(wallet)}</span>
                  </div>
                  <Separator className="my-3" />
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Amount to pay</p>
                    <p className="text-2xl font-extrabold">{fmtBDT(amount)}</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="bkash-pin">bKash PIN</Label>
                  <Input
                    id="bkash-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    autoFocus
                    maxLength={4}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="h-11 text-center text-lg tracking-widest"
                  />
                  <p className="text-xs text-muted-foreground">Demo PIN: any 4 digits</p>
                </div>

                <Button
                  className="h-12 w-full rounded-xl bg-[#E2136E] text-base text-white hover:bg-[#d10a62]"
                  disabled={pin.length < 4}
                  onClick={confirmPay}
                >
                  Confirm &amp; Pay {fmtBDT(amount)}
                </Button>
              </motion.div>
            )}

            {/* ----- Processing ----- */}
            {step === 'processing' && (
              <motion.div
                key="processing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.18 }}
                className="flex min-h-[232px] flex-col items-center justify-center gap-4 text-center"
              >
                <Loader2
                  className="size-10 animate-spin text-[#E2136E] dark:text-[#f04c97]"
                  aria-hidden="true"
                />
                <AnimatePresence mode="wait">
                  <motion.p
                    key={statusIdx}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18 }}
                    className="text-sm font-medium text-muted-foreground"
                    aria-live="polite"
                  >
                    {PROCESS_LINES[statusIdx]}
                  </motion.p>
                </AnimatePresence>
                <p className="text-xs text-muted-foreground">
                  {fmtBDT(amount)} · <span className="font-mono">{formatWallet(wallet)}</span>
                </p>
              </motion.div>
            )}

            {/* ----- Success ----- */}
            {step === 'success' && (
              <motion.div
                key="success"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.18 }}
                className="flex flex-col items-center gap-3 py-2 text-center"
              >
                <motion.span
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 280, damping: 18 }}
                >
                  <CheckCircle2 className="size-16 text-emerald-500" aria-hidden="true" />
                </motion.span>
                <h3 className="text-lg font-bold">Payment successful</h3>
                <div className="w-full space-y-1.5 rounded-xl bg-muted/50 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Transaction ID</span>
                    <span className="font-mono font-semibold">{txnId}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-bold">{fmtBDT(amount)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Wallet</span>
                    <span className="font-mono">{formatWallet(wallet)}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  Placing your order…
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  )
}
