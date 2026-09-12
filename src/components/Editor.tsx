import { useRef } from 'react'
import { SAMPLE_SCRIPT } from '../lib/script'

interface Props {
  value: string
  onChange: (text: string) => void
  onDone: () => void
}

export function Editor({ value, onChange, onDone }: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const words = value.trim() ? value.trim().split(/\s+/).length : 0

  const loadFile = async (file: File | undefined) => {
    if (!file) return
    onChange(await file.text())
    if (fileInput.current) fileInput.current.value = ''
  }

  return (
    <div className="sheet editor">
      <header className="top">
        <div className="brand"><span>Script</span><span className="mono value">{words} words · ~{Math.max(1, Math.round(words / 150))} min</span></div>
        <div className="top-actions">
          <button className="chip" onClick={() => fileInput.current?.click()}>Open file</button>
          <button className="chip" onClick={() => onChange(SAMPLE_SCRIPT)}>Sample</button>
          <button className="chip primary" onClick={onDone}>Done</button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.md,.markdown,text/plain,text/markdown"
          hidden
          onChange={(e) => loadFile(e.target.files?.[0])}
        />
      </header>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={'Paste your script here.\n\nPut [S1], [S2] … at the start of a section to mark scenes.'}
        spellCheck={false}
        autoFocus
      />
      <p className="fine pad">
        Scene markers like <code className="mono">[S7]</code> become jump points. Markdown headings and emphasis are stripped for reading.
      </p>
    </div>
  )
}
