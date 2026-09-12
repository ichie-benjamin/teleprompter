import { useRef } from 'react'
import { SAMPLE_SCRIPT } from '../lib/script'

interface Props {
  value: string
  onChange: (text: string) => void
  onDone: () => void
}

export function Editor({ value, onChange, onDone }: Props) {
  const fileInput = useRef<HTMLInputElement>(null)

  const loadFile = async (file: File | undefined) => {
    if (!file) return
    onChange(await file.text())
    if (fileInput.current) fileInput.current.value = ''
  }

  return (
    <div className="sheet editor">
      <header className="bar">
        <strong>Script</strong>
        <div className="row">
          <button className="btn" onClick={() => fileInput.current?.click()}>Load .txt / .md</button>
          <button className="btn" onClick={() => onChange(SAMPLE_SCRIPT)}>Sample</button>
          <button className="btn primary" onClick={onDone}>Done</button>
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
        placeholder={'Paste your script here.\n\nUse [S1], [S2] … at the start of a section to mark scenes.'}
        spellCheck={false}
        autoFocus
      />
      <p className="hint">
        Scene markers like <code>[S7]</code> become jump points. Markdown headings and emphasis are stripped for reading.
      </p>
    </div>
  )
}
