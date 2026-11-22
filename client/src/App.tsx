import { useEffect, useState } from 'react'
import { deployment } from './deployment'
import { type ActionView, chain, guardAbi } from './lib/chain'
import { percent, price, short, statusLabel, tokens, triggerLabel } from './lib/format'
import { useNow, useSnapshot, useWallet } from './lib/hooks'

const BRAND = 'Veto'
const PENDING = 1

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 3 6 10v13c0 11 7.5 19 18 22 10.500-3 18-11 18-22V10L24 3Z" fill="#0b1a3a" stroke="#2563eb" strokeWidth="2.500" />
      <path d="M24 3v42c10.500-3 18-11 18-22V10L24 3Z" fill="#f97316" opacity="0.9" />
      <rect x="21.500" y="14" width="5" height="15" rx="2.500" fill="#02040d" />
      <circle cx="24" cy="35" r="3" fill="#02040d" />
    </svg>
  )
}

function Boot({ done }: { done: boolean }) {
  return (
    <div className={`boot${done ? ' boot-done' : ''}`} aria-hidden={done}>
      <Mark />
      <p className="mono boot-tag">SYS_BOOT // VETO_LEVEL_ALPHA</p>
      <h1>{BRAND}</h1>
      <p className="mono boot-line">INITIALIZING GUARD...</p>
      <div className="boot-track">
        <div className="boot-fill" />
      </div>
    </div>
  )
}

function Ring({ left, total }: { left: number; total: number }) {
  const radius = 92
  const circumference = 2 * Math.PI * radius
  const share = total > 0 ? Math.min(1, Math.max(0, left / total)) : 0
  const urgent = left <= 10
  return (
    <div className={`ring${urgent ? ' ring-urgent' : ''}`} role="timer" aria-label={`${Math.ceil(left)} seconds left`}>
      <svg viewBox="0 0 220 220">
        <circle cx="110" cy="110" r={radius} className="ring-track" />
        <circle
          cx="110"
          cy="110"
          r={radius}
          className="ring-value"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share)}
        />
      </svg>
      <div className="ring-text">
        <strong>{Math.max(0, Math.ceil(left))}</strong>
        <span>seconds left</span>
      </div>
    </div>
  )
}

function Badge({ status }: { status: number }) {
  return <span className={`badge badge-${statusLabel(status).toLowerCase()}`}>{statusLabel(status)}</span>
}

export default function App() {
  const { snapshot, failure } = useSnapshot()
  const wallet = useWallet()
  const now = useNow()
  const [booted, setBooted] = useState(false)
  const [view, setView] = useState<'dashboard' | 'history'>(() =>
    window.location.hash.startsWith('#history') ? 'history' : 'dashboard'
  )
  const [resizeBps, setResizeBps] = useState(2500)
  const focusId = Number(/^#action-(\d+)/.exec(window.location.hash)?.[1] ?? 0)

  useEffect(() => {
    const timer = setTimeout(() => setBooted(true), 1500)
    return () => clearTimeout(timer)
  }, [])

  const active = snapshot?.actions.find((action) => action.id === snapshot.activeId && action.status === PENDING)
  const chainNow = now + (snapshot?.chainOffset ?? 0)
  const left = active ? active.deadline - chainNow : 0
  const isOwner = !!wallet.account && !!snapshot && wallet.account.toLowerCase() === snapshot.owner.toLowerCase()
  const canDecide = isOwner && wallet.onChain && !wallet.busy

  const decide = (kind: 'approve' | 'veto' | 'resize' | 'executeDefault', action: ActionView) =>
    wallet.act(kind === 'executeDefault' ? 'Execute default' : kind[0]!.toUpperCase() + kind.slice(1), (client, from) => {
      const base = { account: from, chain, address: deployment.guard, abi: guardAbi } as const
      if (kind === 'resize') {
        return client.writeContract({ ...base, functionName: 'resize', args: [BigInt(action.id), resizeBps] })
      }
      return client.writeContract({ ...base, functionName: kind, args: [BigInt(action.id)] })
    })

  const walletLabel = wallet.account ? (wallet.onChain ? short(wallet.account) : 'Switch network') : 'Connect wallet'

  return (
    <>
      <Boot done={booted} />
      <header className="nav">
        <a className="brand" href="#" onClick={() => setView('dashboard')}>
          <Mark />
          <span>
            <b>{BRAND}</b>
            <small className="mono">REACTIVE RISK GUARD</small>
          </span>
        </a>
        <nav aria-label="Primary">
          <button className={view === 'dashboard' ? 'pill pill-on' : 'pill'} onClick={() => setView('dashboard')}>
            Dashboard
          </button>
          <button className={view === 'history' ? 'pill pill-on' : 'pill'} onClick={() => setView('history')}>
            History
          </button>
        </nav>
        <div className="wallet">
          <button className="cta" onClick={wallet.onConnectClick} aria-haspopup={wallet.choices.length > 1}>
            {walletLabel}
          </button>
          {wallet.menuOpen && (
            <ul className="menu" role="menu" aria-label="Choose a wallet">
              {wallet.choices.map((choice) => (
                <li key={choice.uuid} role="none">
                  <button role="menuitem" onClick={() => void wallet.connect(choice)}>
                    {choice.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <main>
        {failure && <p className="notice">{snapshot ? 'Retrying' : 'Cannot read the chain'}: {failure}</p>}

        {view === 'dashboard' && (
          <div className="dash">
            <section className="panel hero" aria-live="polite">
              {!snapshot && <p className="muted">Reading the guard...</p>}

              {snapshot && active && (
                <>
                  <Ring left={left} total={Math.max(active.deadline - active.openedAt, left)} />
                  <div className="hero-body">
                    <p className="mono tag">{active.escalated ? 'ESCALATED // FULL EXIT PROPOSED' : 'DECISION WINDOW OPEN'}</p>
                    <h2>
                      {triggerLabel(active.trigger)} at {price(active.triggerPrice)}
                    </h2>
                    <p className="muted">
                      If you do nothing, {percent(active.proposedBps)} of the position is sold into stable when the timer
                      ends.
                    </p>

                    {left > 0 ? (
                      <>
                        <div className="actions">
                          <button className="go" disabled={!canDecide} onClick={() => void decide('approve', active)}>
                            Approve {percent(active.proposedBps)}
                          </button>
                          <button className="ghost" disabled={!canDecide} onClick={() => void decide('veto', active)}>
                            Veto
                          </button>
                        </div>
                        <div className="resize">
                          <label htmlFor="resize">Resize to {percent(resizeBps)}</label>
                          <input
                            id="resize"
                            type="range"
                            min={100}
                            max={10000}
                            step={100}
                            value={resizeBps}
                            onChange={(event) => setResizeBps(Number(event.target.value))}
                          />
                          <button className="ghost" disabled={!canDecide} onClick={() => void decide('resize', active)}>
                            Sell {percent(resizeBps)}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="actions">
                        <button className="go" disabled={!wallet.account || wallet.busy} onClick={() => void decide('executeDefault', active)}>
                          Execute default now
                        </button>
                      </div>
                    )}

                    {!wallet.account && <p className="muted small">Connect the position owner to decide.</p>}
                    {wallet.account && !wallet.onChain && <p className="muted small">Your wallet is on another network. Press the button at the top right to switch to {chain.name}.</p>}
                    {wallet.account && wallet.onChain && !isOwner && left > 0 && (
                      <p className="muted small">This wallet is not the owner. Owner: {short(snapshot.owner)}.</p>
                    )}
                  </div>
                </>
              )}

              {snapshot && !active && (
                <div className="hero-body idle">
                  <p className="mono tag">WATCHING // {deployment.decisionWindow}S WINDOW ARMED</p>
                  <h2>{price(snapshot.price)}</h2>
                  <p className="muted">
                    Pool price in stable per risk token. A drop or a stop-loss approach opens a countdown here within
                    about two seconds.
                  </p>
                  {snapshot.actions[0] && (
                    <p className="last">
                      Last action {snapshot.actions[0].id}: <Badge status={snapshot.actions[0].status} /> after a{' '}
                      {triggerLabel(snapshot.actions[0].trigger).toLowerCase()}
                    </p>
                  )}
                </div>
              )}
            </section>

            <aside className="side">
              <section className="panel">
                <h3>Position</h3>
                <dl>
                  <div><dt>Pool price</dt><dd>{snapshot ? price(snapshot.price) : '-'}</dd></div>
                  <div><dt>Risk tokens</dt><dd>{snapshot ? tokens(snapshot.vaultRisk) : '-'}</dd></div>
                  <div><dt>Stable held</dt><dd>{snapshot ? tokens(snapshot.vaultStable) : '-'}</dd></div>
                </dl>
              </section>
              <section className="panel">
                <h3>Guard</h3>
                <dl>
                  <div><dt>Actions so far</dt><dd>{snapshot?.count ?? '-'}</dd></div>
                  <div><dt>Owner</dt><dd>{snapshot ? short(snapshot.owner) : '-'}</dd></div>
                  <div>
                    <dt>Contract</dt>
                    <dd>
                      <a href={`${deployment.explorer}/address/${deployment.guard}`} target="_blank" rel="noreferrer">
                        {short(deployment.guard)}
                      </a>
                    </dd>
                  </div>
                </dl>
              </section>
            </aside>
          </div>
        )}

        {view === 'history' && (
          <section className="panel history">
            <h2>History</h2>
            {snapshot && snapshot.actions.length === 0 && <p className="muted">No actions yet.</p>}
            <div className="rows" role="table" aria-label="Actions">
              {snapshot?.actions.map((action) => (
                <div key={action.id} role="row" className={`row${action.id === focusId ? ' row-focus' : ''}`} id={`action-${action.id}`}>
                  <span role="cell" className="mono">#{action.id}</span>
                  <span role="cell">{triggerLabel(action.trigger)}</span>
                  <span role="cell"><Badge status={action.status} /></span>
                  <span role="cell">{action.executedBps ? `${percent(action.executedBps)} sold` : 'nothing sold'}</span>
                  <span role="cell">at {price(action.triggerPrice)}</span>
                  <span role="cell">{action.stableReceived ? `${tokens(action.stableReceived)} stable` : ''}</span>
                  <span role="cell" className="muted">
                    {action.resolvedAt ? `${action.resolvedAt - action.openedAt}s open` : 'open now'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {wallet.note && <p className="note" role="status">{wallet.note}</p>}
      </main>
    </>
  )
}
