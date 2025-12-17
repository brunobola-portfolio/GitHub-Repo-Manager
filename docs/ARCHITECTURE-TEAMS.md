# GitHub Repo Manager - Teams Architecture

## 📋 Visão Geral

**Princípio Fundamental:** Tudo é gerido via GitHub API. Azure DevOps é usado APENAS para migração de repositórios.

---

## 🏗️ Arquitetura de Teams

### Frontend Components

1. **TeamHub.jsx** - Lista e gestão de equipas
   - Criar/Editar/Eliminar equipas
   - Visualizar membros e repositórios
   - Dados armazenados em SQLite local

2. **TeamDetails.jsx** - Gestão detalhada de equipa
   - **Activity Tab**: Eventos do GitHub (commits, PRs, issues) via GitHub API
   - **Members Tab**: Adicionar/Remover membros via GitHub API Search
   - **Repositories Tab**: Assignar repos GitHub e gerir colaboradores
   - **Actions Tab**: Workflows e runs do GitHub Actions

3. **ActivityTab.jsx** - Stream de atividade
   - Busca eventos via GitHub API `/repos/{owner}/{repo}/events`
   - Suporta MOCK_MODE para desenvolvimento

---

## 🔗 Integrações GitHub API

### Teams & Members
```
GET  /api/teams                       → Lista teams do user
POST /api/teams                       → Cria team (SQLite)
GET  /api/teams/:id                   → Detalhes team + members + repos
POST /api/teams/:id/members           → Adiciona member (via GitHub API Search)
PUT  /api/teams/:id/members/:userId   → Atualiza role
DELETE /api/teams/:id/members/:userId → Remove member
```

### Repositories Assignment
```
POST /api/teams/:id/repos             → Assign repo GitHub ao team
GET  /api/repos/:owner/:repo/collaborators → Lista colaboradores GitHub
PUT  /api/repos/:owner/:repo/collaborators/:username → Adiciona colaborador GitHub
```

### Activity Stream
```
GET /api/teams/:id/activity           → Agrega eventos de todos repos assigned
  └─→ Para cada repo: GET /repos/{owner}/{repo}/events (GitHub API)
```

### GitHub Actions
```
GET  /api/repos/:owner/:repo/actions/workflows       → Lista workflows
POST /api/repos/:owner/:repo/actions/workflows/:id/dispatches → Trigger workflow
GET  /api/repos/:owner/:repo/actions/runs            → Lista runs
POST /api/repos/:owner/:repo/actions/sync            → Sync runs para DB
GET  /api/repos/:owner/:repo/actions/stats           → Estatísticas calculadas
```

---

## 💾 Database Schema (SQLite)

### Tables

**users** - Cache de users GitHub
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY,        -- GitHub ID
    username TEXT NOT NULL,
    avatar_url TEXT,
    email TEXT,
    last_login TEXT,
    created_at TEXT
)
```

**teams** - Equipas locais
```sql
CREATE TABLE teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    owner_id INTEGER NOT NULL,
    created_at TEXT,
    FOREIGN KEY (owner_id) REFERENCES users(id)
)
```

**team_members** - Membros de equipas
```sql
CREATE TABLE team_members (
    team_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT CHECK(role IN ('owner', 'admin', 'member')),
    joined_at TEXT,
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
)
```

**repo_assignments** - Repos assigned a teams
```sql
CREATE TABLE repo_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    repo_full_name TEXT NOT NULL,  -- e.g. "owner/repo"
    repo_id INTEGER NOT NULL,       -- GitHub Repo ID
    assigned_by INTEGER NOT NULL,
    assigned_at TEXT,
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (assigned_by) REFERENCES users(id)
)
```

**workflow_runs** - Cache de GitHub Actions runs
```sql
CREATE TABLE workflow_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    github_run_id INTEGER UNIQUE NOT NULL,
    repo_id INTEGER NOT NULL,
    workflow_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    conclusion TEXT,
    started_at TEXT NOT NULL,
    duration_seconds INTEGER,
    -- ... outros campos
)
```

---

## 🔄 Fluxos de Dados

### 1. Activity Feed
```
User → ActivityTab
  → GET /api/teams/{id}/activity
    → Backend: Busca repos assigned ao team
      → Para cada repo: GET /repos/{owner}/{repo}/events (GitHub API)
        → Agrega, deduplica, ordena por data
          → Retorna eventos unificados
```

### 2. Adicionar Member
```
User → Search GitHub Username
  → GET /api/search/users?q={username} (GitHub API)
    → Seleciona user
      → POST /api/teams/{id}/members
        → Backend: Verifica se user existe no GitHub
          → Adiciona a team_members (SQLite)
            → Retorna sucesso
```

### 3. Assign Repository
```
User → Seleciona repo da lista
  → POST /api/teams/{id}/repos
    → Backend: Salva em repo_assignments (SQLite)
      → Team pode agora gerir colaboradores via GitHub API
```

### 4. Adicionar Colaborador ao Repo
```
User → Expande repo no TeamDetails
  → GET /api/repos/{owner}/{repo}/collaborators (GitHub API)
    → Mostra colaboradores atuais
      → User clica "Add" num team member
        → PUT /api/repos/{owner}/{repo}/collaborators/{username} (GitHub API)
          → Envia convite via GitHub
```

### 5. GitHub Actions Stats
```
User → Abre Actions tab
  → Seleciona repo
    → GET /api/repos/{owner}/{repo}/actions/workflows (GitHub API)
    → GET /api/repos/{owner}/{repo}/actions/runs (GitHub API)
      → Mostra workflows e runs
        → User clica "Sync"
          → POST /api/repos/{owner}/{repo}/actions/sync
            → Guarda runs em workflow_runs (SQLite)
              → Calcula estatísticas localmente
```

---

## ☁️ Azure DevOps Integration

**IMPORTANTE**: Azure DevOps é usado APENAS para MIGRAÇÃO, não para gestão.

### Componentes
- **AzureImportModal.jsx** - UI para importar repos
- **useGitHub.js** - `importFromAzure()` function
- Botões em Header/Sidebar para abrir modal

### Fluxo de Migração
```
User → Clica "Azure Import"
  → Preenche: Org, Project, Repo, PAT
    → POST /api/import-azure (se implementado)
      → Backend conecta ao Azure DevOps
        → Clona repo para GitHub
          → Retorna novo repo GitHub
```

**Após migração**: Repo é gerido 100% via GitHub API.

---

## ✅ Validação

### Teams ✅
- Criar/Editar/Eliminar: SQLite local
- Members: GitHub API Search + SQLite
- Repos: GitHub repos assignados no SQLite

### Activity ✅
- 100% GitHub API `/repos/{owner}/{repo}/events`
- Agregado de todos repos assigned ao team

### Actions ✅
- 100% GitHub API `/repos/{owner}/{repo}/actions/*`
- Cache de runs em SQLite para estatísticas

### Members ✅
- Search: GitHub API `/search/users`
- Invite: GitHub API (via colaboradores)

### Repositories ✅
- Listagem: GitHub API `/user/repos`
- Colaboradores: GitHub API `/repos/{owner}/{repo}/collaborators`

### Azure DevOps ✅
- APENAS para migração
- Não usado para gestão diária

---

## 🎯 Conclusão

**Tudo está correto!** A arquitetura segue os princípios:

1. ✅ Teams geridos localmente (SQLite)
2. ✅ Members via GitHub API
3. ✅ Activity via GitHub API
4. ✅ Actions via GitHub API
5. ✅ Repositories via GitHub API
6. ✅ Azure DevOps apenas para migração

Não há confusão entre GitHub e Azure DevOps. Cada um tem o seu papel bem definido.
