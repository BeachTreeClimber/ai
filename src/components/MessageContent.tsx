

export function MessageContent({ text }: { text: string }) {
  // Image markdown: ![...](data:image/...) or https://
  const imgRe = /!\[([^\]]*)\]\((data:image\/[^)]+|https?:\/\/[^)]+)\)/g
  const parts: Array<string | JSX.Element> = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  const images: JSX.Element[] = []
  while ((m = imgRe.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    images.push(<img key={key++} src={m[2]} alt={m[1]} className="generated-image" />)
    last = m.index + m[0].length
  }
  if (images.length) {
    if (last < text.length) parts.push(text.slice(last))
    // If the whole message was just the image markdown, render only images
    if (parts.every((p) => typeof p === 'string' && !p.trim())) {
      return <>{images}</>
    }
    return (
      <>
        {parts.map((p, i) => (typeof p === 'string' ? <span key={i}>{renderCode(p)}</span> : p))}
        {images}
      </>
    )
  }
  return <>{renderCode(text)}</>
}

function renderCode(text: string) {
  // Split on ``` fences — odd indices are code blocks
  const segs = text.split(/```[a-zA-Z]*\n?/)
  return segs.map((seg, i) =>
    i % 2 === 1 ? (
      <pre key={i} className="code-block">
        <code>{seg.replace(/```$/, '').trimEnd()}</code>
      </pre>
    ) : (
      <span key={i}>{seg}</span>
    ),
  )
}
