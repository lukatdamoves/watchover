<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <title>WatchOver System Documentation</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />

    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

    <!-- Marked (Markdown parser) -->
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <!-- DOMPurify (security) -->
    <script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js"></script>

    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        :root {
            --bg-main: #050816;
            --bg-card: #111827;
            --bg-card-soft: #0b1220;
            --accent: #6366f1;
            --accent-soft: rgba(99, 102, 241, 0.15);
            --accent-strong: #4f46e5;
            --text-main: #e5e7eb;
            --text-muted: #9ca3af;
            --border-subtle: rgba(255, 255, 255, 0.08);
        }

        body {
            font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: radial-gradient(circle at top, #1f2937 0, #020617 45%, #000 100%);
            color: var(--text-main);
            min-height: 100vh;
        }

        .page {
            max-width: 1100px;
            margin: 0 auto;
            padding: 16px 16px 32px 16px;
        }

        .header-card {
            margin-top: 12px;
            margin-bottom: 18px;
            padding: 18px 16px;
            border-radius: 18px;
            background: radial-gradient(circle at top left, #1e293b 0, #020617 55%);
            border: 1px solid var(--border-subtle);
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .title-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
        }

        .title-block h1 {
            font-size: 22px;
            font-weight: 700;
            letter-spacing: 0.02em;
        }

        .title-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 3px 9px;
            border-radius: 999px;
            background: rgba(15, 23, 42, 0.9);
            border: 1px solid rgba(148, 163, 184, 0.35);
            font-size: 11px;
            color: var(--text-muted);
        }

        .title-pill-dot {
            width: 6px;
            height: 6px;
            border-radius: 999px;
            background: #22c55e;
            box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.25);
        }

        .subtitle {
            margin-top: 4px;
            font-size: 13px;
            color: var(--text-muted);
        }

        .meta-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
            font-size: 11px;
            color: var(--text-muted);
        }

        .meta-pill {
            padding: 3px 8px;
            border-radius: 999px;
            border: 1px solid rgba(148, 163, 184, 0.4);
            background: rgba(15, 23, 42, 0.85);
        }

        .download-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 7px 14px;
            border-radius: 999px;
            border: none;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            background: linear-gradient(135deg, var(--accent) 0, var(--accent-strong) 100%);
            color: #f9fafb;
            box-shadow: 0 8px 22px rgba(79, 70, 229, 0.5);
            text-decoration: none;
        }

        .download-btn svg {
            width: 14px;
            height: 14px;
        }

        .download-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 10px 26px rgba(79, 70, 229, 0.75);
        }

        .download-btn:active {
            transform: translateY(0);
            box-shadow: 0 6px 18px rgba(79, 70, 229, 0.6);
        }

        .content-card {
            border-radius: 18px;
            background: radial-gradient(circle at top, rgba(15, 23, 42, 0.95) 0, #020617 55%);
            border: 1px solid var(--border-subtle);
            padding: 18px 14px 22px 14px;
            box-shadow: 0 18px 60px rgba(15, 23, 42, 0.95);
        }

        .toc {
            margin-bottom: 16px;
            padding: 10px 12px;
            border-radius: 12px;
            background: rgba(15, 23, 42, 0.95);
            border: 1px solid rgba(148, 163, 184, 0.35);
        }

        .toc-title {
            font-size: 12px;
            font-weight: 600;
            color: var(--text-muted);
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .toc-title span {
            width: 4px;
            height: 4px;
            border-radius: 999px;
            background: var(--accent);
        }

        .toc-list {
            list-style: none;
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }

        .toc-list a {
            font-size: 11px;
            color: var(--text-muted);
            text-decoration: none;
            padding: 4px 8px;
            border-radius: 999px;
            background: rgba(15, 23, 42, 0.9);
            border: 1px solid rgba(55, 65, 81, 0.7);
        }

        .toc-list a:hover {
            border-color: var(--accent);
            color: var(--text-main);
        }

        #markdown-root {
            font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 18px;
            line-height: 1.8;
            color: #e5e7eb;
        }

        #markdown-root h1 {
            font-size: 24px;
            margin-bottom: 10px;
        }

        #markdown-root h2 {
            font-size: 20px;
            margin-top: 18px;
            margin-bottom: 8px;
            padding-left: 8px;
            border-left: 3px solid var(--accent);
        }

        #markdown-root h3 {
            font-size: 17px;
            margin-top: 14px;
            margin-bottom: 6px;
        }

        #markdown-root p {
            margin-bottom: 8px;
        }

        #markdown-root ul,
        #markdown-root ol {
            margin: 6px 0 10px 20px;
        }

        #markdown-root li {
            margin-bottom: 4px;
        }

        #markdown-root code {
            font-family: 'JetBrains Mono', 'Courier New', monospace;
            background: rgba(15, 23, 42, 0.9);
            padding: 1px 5px;
            border-radius: 4px;
            border: 1px solid rgba(148, 163, 184, 0.4);
            font-size: 14px;
        }

        #markdown-root pre code {
            background: transparent;
            border: none;
            padding: 0;
        }

        #markdown-root pre {
            background: #020617;
            border-radius: 10px;
            padding: 10px;
            border: 1px solid rgba(148, 163, 184, 0.4);
            overflow-x: auto;
            font-size: 14px;
        }

        #markdown-root table {
            width: 100%;
            border-collapse: collapse;
            margin: 10px 0 14px 0;
            font-size: 14px;
        }

        #markdown-root th,
        #markdown-root td {
            border: 1px solid rgba(55, 65, 81, 0.9);
            padding: 6px 8px;
        }

        #markdown-root th {
            background: rgba(15, 23, 42, 0.95);
            font-weight: 600;
        }

        #markdown-root tr:nth-child(even) {
            background: rgba(15, 23, 42, 0.8);
        }

        #markdown-root a {
            color: #93c5fd;
            text-decoration: none;
        }

        #markdown-root a:hover {
            text-decoration: underline;
        }

        .scroll-area {
            max-height: calc(100vh - 220px);
            overflow-y: auto;
            padding-right: 4px;
        }

        .scroll-area::-webkit-scrollbar {
            width: 10px;
        }

        .scroll-area::-webkit-scrollbar-track {
            background: #020617;
        }

        .scroll-area::-webkit-scrollbar-thumb {
            background: rgba(55, 65, 81, 0.9);
            border-radius: 999px;
        }

        .scroll-area::-webkit-scrollbar-thumb:hover {
            background: rgba(75, 85, 99, 1);
        }

        @media (max-width: 768px) {
            .page {
                padding: 12px 10px 24px 10px;
            }

            .header-card {
                padding: 14px 12px;
                gap: 8px;
            }

            .title-row {
                flex-direction: column;
                align-items: flex-start;
            }

            .content-card {
                padding: 12px 10px 16px 10px;
            }

            .scroll-area {
                max-height: none;
            }

            #markdown-root {
                font-size: 13px;
            }

            #markdown-root h1 {
                font-size: 18px;
            }

            #markdown-root h2 {
                font-size: 16px;
            }

            #markdown-root h3 {
                font-size: 14px;
            }
        }
    </style>
</head>
<body>
<div class="page">
    <div class="header-card">
        <div class="title-row">
            <div class="title-block">
                <h1>WatchOver System Overview</h1>
                <p class="subtitle">Complete technical documentation viewable on any device</p>
            </div>
        </div>
        <div class="meta-row">
            <span class="title-pill">
                <span class="title-pill-dot"></span>
                Internal team docs
            </span>
            <span class="meta-pill">Format: Markdown</span>
            <span class="meta-pill">Project: WatchOver</span>
        </div>
    </div>

    <div class="content-card">
        <div class="toc" id="toc" style="display:none;">
            <div class="toc-title"><span></span>Sections</div>
            <ul class="toc-list" id="toc-list"></ul>
        </div>
        <div class="scroll-area">
            <div id="markdown-root">Loading documentation...</div>
        </div>
    </div>
</div>

<script>
    async function loadMarkdown() {
        try {
            const res = await fetch('docs/system-guide.md');
            if (!res.ok) {
                document.getElementById('markdown-root').textContent = 'Could not load markdown file.';
                return;
            }
            const md = await res.text();
            const html = marked.parse(md);
            const clean = DOMPurify.sanitize(html);
            const root = document.getElementById('markdown-root');
            root.innerHTML = clean;
            buildToc();
        } catch (e) {
            document.getElementById('markdown-root').textContent = 'Error loading documentation.';
        }
    }

    function buildToc() {
        const root = document.getElementById('markdown-root');
        const headings = root.querySelectorAll('h2');
        if (!headings.length) return;

        const toc = document.getElementById('toc');
        const list = document.getElementById('toc-list');
        list.innerHTML = '';

        headings.forEach((h, idx) => {
            if (!h.id) {
                h.id = 'section-' + (idx + 1);
            }
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = '#' + h.id;
            a.textContent = h.textContent.replace(/^#+\s*/, '');
            li.appendChild(a);
            list.appendChild(li);
        });

        toc.style.display = 'block';
    }

    loadMarkdown();
</script>
</body>
</html>
