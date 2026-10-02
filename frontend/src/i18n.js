export const messages = {
  pt: {
    title: '1fichier Downloader',
    apiKey: 'API key do 1fichier (Parâmetros → API)',
    apiKeySaved: 'API key guardada ✔ (escreve para substituir)',
    save: 'Guardar',
    inputPlaceholder:
      'Cola aqui o link da pasta (https://1fichier.com/dir/...), o JSON ou uma lista de links, um por linha',
    loadFile: 'Carregar ficheiro JSON/TXT',
    linksAreFolders: 'os links são pastas',
    seriesName: 'Nome da série (opcional — senão é detectado do nome de cada ficheiro)',
    loading: 'A listar…',
    files: (n) => `${n} ficheiros`,
    downloadAll: 'Descarregar todos',
    colName: 'Nome',
    colSE: 'Temporada/Episódio',
    colSize: 'Tamanho',
    colFolder: 'Pasta de destino',
    downloads: 'Downloads',
    clearFinished: 'Limpar terminados',
    cancel: 'Cancelar',
    status: {
      queued: 'na fila',
      getting_link: 'a obter link',
      downloading: 'a descarregar',
      done: 'concluído',
      error: 'erro',
      canceled: 'cancelado',
    },
  },
  en: {
    title: '1fichier Downloader',
    apiKey: '1fichier API key (Parameters → API)',
    apiKeySaved: 'API key saved ✔ (type to replace)',
    save: 'Save',
    inputPlaceholder:
      'Paste the folder link (https://1fichier.com/dir/...), the JSON or a list of links, one per line',
    loadFile: 'Load JSON/TXT file',
    linksAreFolders: 'links are folders',
    seriesName: 'Series name (optional — otherwise detected from each file name)',
    loading: 'Listing…',
    files: (n) => `${n} files`,
    downloadAll: 'Download all',
    colName: 'Name',
    colSE: 'Season/Episode',
    colSize: 'Size',
    colFolder: 'Destination folder',
    downloads: 'Downloads',
    clearFinished: 'Clear finished',
    cancel: 'Cancel',
    status: {
      queued: 'queued',
      getting_link: 'getting link',
      downloading: 'downloading',
      done: 'done',
      error: 'error',
      canceled: 'canceled',
    },
  },
}

export function initialLang() {
  try {
    const saved = localStorage.getItem('lang')
    if (saved in messages) return saved
  } catch {}
  return navigator.language?.startsWith('pt') ? 'pt' : 'en'
}
