# Репозиторий и доступ

## Репозиторий

`Denbassk/family-market-matrix` — **приватный**, ветка `main`.
Рабочая копия = сама папка проекта, `git push` из неё уходит туда.

Аккаунт GitHub: `Denbassk`.
Коммиты: `Dan <denbassk@gmail.com>`, `core.quotepath=false` (кириллица в путях).

## Доступ по deploy-ключу

Не токен аккаунта, а **deploy key одного репозитория** с правом записи:
даже при утечке доступ ограничен этим репо. Отзыв — Settings → Deploy keys.

- Приватная часть: `D:\Family_Market_Analytics\credentials\github_deploy_family-market-matrix`
  (вне репозитория, рядом с сервисным ключом BigQuery)
- Публичная зарегистрирована как `cowork-chat (Claude) — read/write`

Подключение в новой сессии:

```bash
bash git_connect.sh
```

Скрипт копирует ключ в `~/.ssh` с правами 600 (на смонтированной из
Windows папке права всегда 700, а ssh такие отвергает), ставит
`core.sshCommand` и переключает origin на `git@github.com:...`.

SSH к github проходит и по 22, и по `ssh.github.com:443`.

## Что НЕ в репозитории

- `apps_script/Claude.gs` — API-ключ Anthropic, см. `mem:apps_script`
- `*credentials*.json`, `*.pem`, `*.key`, `.clasprc.json`
- `__pycache__/`, `*.bak`, `*.log`, `Matrix_logs/`, `АРХИВ/`, `Claude outputs/`, `*.ico`

## Что делать в начале новой сессии

1. Проверить, что подключена папка `Скрипты обновления матрицы`
2. `bash git_connect.sh` — если нужны пуши
3. `python matrix.py check` — если собираешься писать в таблицу
4. Прочитать `mem:gotchas` перед любой перестановкой файлов
