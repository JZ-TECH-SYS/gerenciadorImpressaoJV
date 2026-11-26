# Documentação do gerenciador de impressão (jv-printer)

> Índice geral e convenção da pasta `docs/`. Organizada em 25/11/2026.

## Mapa

| Pasta | Domínio | Índice |
|-------|---------|--------|
| `impressao/` | Impressão no Windows/Linux, confirmação do papel, casos e ensaios | [[impressao/README]] |
| `myzap/` | Módulo MyZap (WhatsApp) integrado ao gerenciador | [[myzap/README]] |

## Convenção

- **Por domínio/assunto**, nunca por tipo de arquivo. Cada subpasta tem um `README.md`
  que é o índice dela (tabela Arquivo · Tipo · O que é).
- Ao adicionar ou mover um doc, atualizar o índice da pasta **e** este mapa.
- Nome de arquivo `.md` em kebab-case minúsculo (sem `_`, acento, espaço ou maiúscula).
  Assets (`.json/.sql/.pdf/.sh`) mantêm o nome de origem.
- **Tipo** do doc no índice: estudo | plano | guia | checklist | chamado | referência.
- Cabeçalho: `# Título` + uma linha em `> blockquote` com contexto, status e data absoluta
  (dd/mm/aaaa).
- Links entre docs com `[[nome-do-arquivo]]` (só o nome, sem caminho nem extensão).
- Não duplicar o que já está no código: o doc explica o porquê e o modelo.
- Concluído ou obsoleto vai para `docs/_historico/`; não apagar histórico útil.

> Commit só com `docs/**` ou `*.md` não dispara o release (`paths-ignore` do
> `release.yml`); commit misto (código + doc) na `main` dispara.
