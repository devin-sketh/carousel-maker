# Carousel Maker — установка на свой хостинг

Статический сайт без бэкенда: 3 файла, открывается в любом браузере. Вызовы Gemini AI и Pexels делаются напрямую из браузера пользователя.

## Что в архиве

| Файл | Что внутри |
|------|------------|
| `index.html` | Разметка интерфейса (3 шага: Текст → Фон → Редактор) |
| `styles.css` | Все стили (включая декор-пресеты, готовые шаблоны, маркер-выделение) |
| `app.js` | Вся логика: drag-n-drop, AI-обращения к Gemini, генерация PDF/PNG |

Никаких сборщиков, `npm install`, бэкендов и баз данных не нужно.

---

## Быстрый старт — проверить локально

1. Распакуйте архив в любую папку.
2. Откройте `index.html` двойным кликом. **Не сработает напрямую** в Chrome из-за CORS-политик `file://` для шрифтов и AI-запросов. Поэтому запустите локальный сервер:

   **Через Python (если установлен):**
   ```bash
   cd carousel-maker
   python3 -m http.server 8000
   ```
   Откройте `http://localhost:8000`.

   **Через Node.js (если установлен):**
   ```bash
   cd carousel-maker
   npx serve .
   ```

   **Через любое расширение VS Code типа Live Server** — правый клик на `index.html` → Open with Live Server.

---

## Куда залить (бесплатно)

### Вариант 1: Cloudflare Pages (рекомендую)

Бесплатно, неограниченный трафик, мгновенный SSL, можно прицепить свой домен.

1. Регистрация: https://dash.cloudflare.com/sign-up
2. В Cloudflare → Workers & Pages → Create application → Pages → **Upload assets**.
3. Назовите проект (например `carousel-maker`) → перетащите все 3 файла в окно загрузки.
4. Нажмите Deploy. Через ~10 секунд получите URL вида `carousel-maker.pages.dev`.
5. Чтобы прицепить свой домен: Pages → ваш проект → Custom domains → Add. Cloudflare сам выдаст DNS-записи для добавления у регистратора.

Обновления: повторно загрузите файлы через тот же UI или подключите GitHub-репо для автодеплоя на каждый push.

### Вариант 2: Netlify

1. https://app.netlify.com/drop — открыть и **перетащить папку с тремя файлами** прямо в окно.
2. Получите URL вида `random-name-12345.netlify.app`. Готово.
3. Свой домен: Site configuration → Domain management → Add domain.

### Вариант 3: GitHub Pages

1. Создайте новый репозиторий на GitHub (например `carousel-maker`).
2. Залейте 3 файла в корень репо.
3. Repo Settings → Pages → Source: `Deploy from a branch` → Branch: `main` / Folder: `/ (root)` → Save.
4. Через 1-2 минуты сайт на `https://<ваш-юзернейм>.github.io/carousel-maker/`.

### Вариант 4: Vercel

1. https://vercel.com → Sign up → Add New → Project.
2. Если есть git-репо — подключите. Если нет — `npm i -g vercel` и `vercel deploy` из папки с файлами.

### Вариант 5: Свой VPS / shared hosting

Закиньте 3 файла в `/var/www/html/` (или куда у вас Nginx/Apache смотрит) и всё.

```nginx
# Минимальный конфиг Nginx:
server {
    listen 80;
    server_name your-domain.ru;
    root /var/www/carousel-maker;
    index index.html;
    location / { try_files $uri $uri/ =404; }
}
```

---

## API ключи — важно прочитать

В `app.js` (примерно строка 5) зашиты два ключа:

```javascript
const GEMINI_API_KEY = 'AIzaSy...';
const PEXELS_API_KEY = '...';
```

Они **видны в DevTools любому посетителю сайта**. Это нормально для прототипа/личного использования, но если сайт пойдёт в публику — лучше ограничить:

### Ограничить Gemini API ключ по сайту
1. https://console.cloud.google.com → APIs & Services → Credentials.
2. Найдите ключ AIzaSy... → Edit.
3. Application restrictions → **HTTP referrers (web sites)**.
4. Добавьте ваш домен: `https://your-domain.com/*`, `https://*.pages.dev/*` и т.п.
5. API restrictions → ограничьте только `Generative Language API`.
6. Save. Теперь ключ работает только с вашего сайта.

### Pexels
Pexels не позволяет ограничивать по referrer на бесплатном тарифе. Если ключ начнёт спамить — просто пересоздайте на https://www.pexels.com/api/.

### Получить свежие ключи (если зашитые перестанут работать)

**Gemini:** https://aistudio.google.com/app/apikey → Create API key → бесплатно, лимит 20–60 запросов в день для большинства моделей. Замените значение `GEMINI_API_KEY` в `app.js`.

**Pexels:** https://www.pexels.com/api/ → Get Started → бесплатно, 200 запросов в час. Замените `PEXELS_API_KEY` в `app.js`.

---

## Лимиты и затраты

- **Хостинг:** $0 на любом из вариантов выше для личного/мелкого использования.
- **Gemini:** бесплатный тариф 20-60 запросов в день (по 1 запросу на анализ шаблона + по 1 на массовое AI-форматирование).
- **Pexels:** бесплатно 200 запросов в час на фото-поиск.
- **Домен:** опционально, ~150-1000 ₽/год.

---

## Что НЕ делать

- ❌ Не публикуйте свой ключ Gemini в GitHub в открытом виде, если не ограничили по referer — иначе боты найдут и исчерпают.
- ❌ Не пытайтесь открыть `index.html` через `file:///` — не сработает (CORS).
- ❌ Не размещайте код на платном Pro-тарифе, пока не убедитесь что бесплатный не хватает.

---

## Поддержка и обновления

Сайт чисто статический — никакой автообновляемости. Чтобы добавить функции/исправить баги — отредактируйте файлы и перезалейте. Если что-то ломается:

1. Откройте DevTools (F12) → Console — увидите ошибки.
2. Network → отфильтруйте по `gemini` / `pexels` — посмотрите ответы API.

Удачи!
