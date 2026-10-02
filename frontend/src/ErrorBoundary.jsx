import { Component } from 'react'

// Se algo rebentar ao desenhar a página, mostra o erro em vez de deixar o ecrã em branco
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main>
        <h2>Light Downloader</h2>
        <p className="err">⚠ Ocorreu um erro ao mostrar a página / Something went wrong while rendering the page.</p>
        <pre className="muted small" style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error?.stack || this.state.error)}</pre>
        <button onClick={() => location.reload()}>Reload</button>
      </main>
    )
  }
}
