// ==UserScript==
// @name         Панель SEO для Алисы AI
// @namespace    https://github.com/xxrxtnxxov
// @version      4.0
// @description  SEO-анализ ответов Алисы: источники, домены, позиции, журнал.
// @author       xxrxtnxxov
// @license      MIT
// @homepage     https://github.com/xxrxtnxxov/alice-ai-seo-panel
// @supportURL   https://github.com/xxrxtnxxov/alice-ai-seo-panel/issues
// @updateURL    https://raw.githubusercontent.com/xxrxtnxxov/alice-ai-seo-panel/main/script.userscript.js
// @downloadURL  https://raw.githubusercontent.com/xxrxtnxxov/alice-ai-seo-panel/main/script.userscript.js
// @match        https://yandex.ru/search*
// @icon         https://...
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_download
// ==/UserScript==

(function () {
    'use strict';

    const C = {
        bg: '#0d1117',
        bgHeader: '#161b22',
        bgSection: '#0d1117',
        border: '#30363d',
        text: '#c9d1d9',
        muted: '#6e7681',
        blue: '#58a6ff',
        green: '#3fb950',
        red: '#f85149',
        orange: '#d29922',
        purple: '#bc8cff',
        cyan: '#39d353',
        leftColor: '#58a6ff',
        rightColor: '#bc8cff',
    };

    function loadSettings() {
        return JSON.parse(GM_getValue('alice_v4_settings', JSON.stringify({
            myDomains: [],
            competitors: [],
            panelX: null,
            panelY: null,
        })));
    }
    function saveSettings(s) { GM_setValue('alice_v4_settings', JSON.stringify(s)); }
    let settings = loadSettings();

    const getQuery = () => new URLSearchParams(location.search).get('text') || '';
    const getLr = () => new URLSearchParams(location.search).get('lr') || '';
    const dateStr = () => new Date().toLocaleDateString('ru-RU');

    function getHostname(url) {
        try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
    }

    function normalizeDomain(raw) {
        return raw.trim().toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .split('/')[0];
    }

    function domainMatches(domain, pattern) {
        const p = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
        return new RegExp('^' + p + '$').test((domain || '').replace(/^www\./, ''));
    }

    function saveLog(entry) {
        const log = JSON.parse(GM_getValue('alice_v4_log', '[]'));
        if (!log.find(e => e.query === entry.query && e.date === entry.date)) {
            log.push(entry);
            GM_setValue('alice_v4_log', JSON.stringify(log.slice(-500)));
        }
    }

    function saveDomainStats(leftDomains, rightDomains) {
        const stats = JSON.parse(GM_getValue('alice_v4_stats', JSON.stringify({ left: {}, right: {} })));
        leftDomains.forEach(d => { stats.left[d] = (stats.left[d] || 0) + 1; });
        rightDomains.forEach(d => { stats.right[d] = (stats.right[d] || 0) + 1; });
        GM_setValue('alice_v4_stats', JSON.stringify(stats));
    }

    function getLeftContainer() {
        return document.querySelector(
            'li[data-fast-name="neuro_answer"], li[class*="futuris-snippet"]'
        ) || null;
    }

    function getRightContainer() {
        return document.querySelector('.EntityCard') || null;
    }

    function hasAliceBlock() {
        return !!(getLeftContainer()?.querySelector('.FuturisGPTMessage-GroupContent') ||
            getRightContainer()?.querySelector('.FuturisGPTMessage-GroupContent'));
    }

    function getSourcesFromContainer(container) {
        if (!container) return {};
        const map = {};
        const groupSources = container.querySelector('.FuturisGPTMessage-GroupSources');
        const sourceEls = groupSources
            ? groupSources.querySelectorAll('.FuturisSource')
            : container.querySelectorAll('.FuturisSource');
        sourceEls.forEach(s => {
            const a = s.tagName === 'A' ? s : s.closest('a');
            const host = (s.querySelector('.FuturisSource-Host')?.textContent || '')
                .trim().replace('*', '');
            const href = a?.href || '';
            if (host && !map[host]) map[host] = href;
        });
        return map;
    }

    function extractCleanText(container) {
        if (!container) return '';
        const content = container.querySelector('.FuturisGPTMessage-GroupContent');
        if (!content) return '';

        const clone = content.cloneNode(true);

        clone.querySelectorAll([
            '.FuturisFootnote', '.FuturisActionsPanel', '.FuturisFeedback',
            '.A11yHidden', '.Scroller-ItemsWrap', '.FuturisGPTMessage-GroupSources',
            '.FuturisImage', 'button', '.FuturisInput', '.FuturisSource',
            '.FuturisSearch', '.FactFeedback', '.FuturisGPTMessage-GroupScroller',
            '.FuturisGPTMessage-GroupScrollerWrapper',
        ].join(',')).forEach(el => el.remove());

        const fc = clone.firstElementChild;
        if (fc && !fc.className && fc.tagName === 'DIV') fc.remove();

        function walk(node) {
            if (node.nodeType === 3) return node.textContent;
            if (node.nodeType !== 1) return '';
            const tag = node.tagName.toLowerCase();
            const isHeading = /^h[1-6]$/.test(tag);
            let inner = [...node.childNodes].map(walk).join('');
            if (isHeading) return '\n## ' + inner.trim() + '\n';
            if (tag === 'li') return '\n• ' + inner.trim();
            if (['p', 'div', 'section', 'article', 'blockquote'].includes(tag) && inner.trim()) {
                return inner.endsWith('\n') ? inner : inner + '\n';
            }
            return inner;
        }

        return walk(clone)
            .replace(/\n{2,}/g, '\n\n')
            .replace(/\n\n([^\n])/g, (_, c) => '\n' + c)
            .replace(/([^\n])\n\n/g, (_, c) => c + '\n')
            .replace(/\n{2,}/g, '\n\n')
            .trim();
    }

    function getOrganicResults() {
        const results = [];
        let pos = 1;
        document.querySelectorAll('li.uEZlbEJdDf0xk').forEach(li => {
            if (li.className.includes('futuris-snippet')) return;
            const h = li.querySelector('h2, h3');
            const a = li.querySelector('a[href^="http"]');
            if (!h || !a) return;
            results.push({ pos: pos++, title: h.textContent.trim(), domain: getHostname(a.href), href: a.href });
        });
        return results;
    }

    function getRelatedQueries() {
        return [...document.querySelectorAll('.RelatedBottom a')]
            .map(a => a.textContent.trim()).filter(Boolean);
    }

    function getAnswerType(container) {
        const block = container?.querySelector('.FuturisGPTMessage-GroupContent');
        if (!block) return 'нет';
        if (block.querySelector('table')) return 'таблица';
        if (block.querySelector('ol')) return 'нумер. список';
        if (block.querySelector('ul')) return 'список';
        if (block.querySelector('h2, h3, h4')) return 'структурир.';
        return 'текст';
    }

    function getTeaserScreenPercent() {
        const teaserLi = getLeftContainer();
        if (!teaserLi) return 0;
        const teaserH = teaserLi.offsetHeight;
        const offsetTop = teaserLi.offsetTop;
        const vh = window.innerHeight;
        return Math.round(Math.min(teaserH, Math.max(0, vh - offsetTop)) / vh * 100);
    }

    function analyze() {
        if (!hasAliceBlock()) return null;

        const leftContainer = getLeftContainer();
        const rightContainer = getRightContainer();

        const leftSources = getSourcesFromContainer(leftContainer);
        const rightSources = getSourcesFromContainer(rightContainer);

        const leftDomains = Object.keys(leftSources);
        const rightDomains = Object.keys(rightSources);

        const organic = getOrganicResults();
        const related = getRelatedQueries();
        const query = getQuery();

        const myInLeft = settings.myDomains.filter(p => leftDomains.some(d => domainMatches(d, p)));
        const myInRight = settings.myDomains.filter(p => rightDomains.some(d => domainMatches(d, p)));

        const myInOrganic = organic.filter(r => settings.myDomains.some(p => domainMatches(r.domain, p)));

        const compInLeft = settings.competitors.filter(p => leftDomains.some(d => domainMatches(d, p)));
        const compInRight = settings.competitors.filter(p => rightDomains.some(d => domainMatches(d, p)));

        const allSourceDomains = [...new Set([...leftDomains, ...rightDomains])];
        const sourceInOrganic = organic.filter(r => allSourceDomains.some(d => d.includes(r.domain) || r.domain.includes(d)));

        const data = {
            query, date: dateStr(),
            leftContainer: !!leftContainer,
            rightContainer: !!rightContainer,
            leftSources, rightSources,
            leftDomains, rightDomains,
            leftSourcesCount: leftDomains.length,
            rightSourcesCount: rightDomains.length,
            organic, related,
            myInLeft, myInRight, myInOrganic,
            compInLeft, compInRight,
            sourceInOrganic,
            leftAnswerType: getAnswerType(leftContainer),
            rightAnswerType: getAnswerType(rightContainer),
            screenPercent: getTeaserScreenPercent(),
        };

        saveLog({
            query, date: dateStr(),
            hasLeft: !!leftContainer,
            hasRight: !!rightContainer,
            myInLeft: myInLeft.length > 0,
            myInRight: myInRight.length > 0,
            leftSourcesCount: leftDomains.length,
            rightSourcesCount: rightDomains.length,
            leftAnswerType: data.leftAnswerType,
            rightAnswerType: data.rightAnswerType,
            screenPercent: data.screenPercent,
        });
        saveDomainStats(leftDomains, rightDomains);

        return data;
    }

    function renderSourceChips(sources, color) {
        return Object.entries(sources).map(([domain, href]) => {
            const isMyDomain = settings.myDomains.some(p => domainMatches(domain, p));
            const isComp = settings.competitors.some(p => domainMatches(domain, p));
            const chipColor = isMyDomain ? C.green : isComp ? C.orange : color;
            const bg = isMyDomain ? 'rgba(63,185,80,0.1)' : isComp ? 'rgba(210,153,34,0.1)' : 'rgba(255,255,255,0.05)';
            const title = isMyDomain ? '✅ Ваш домен' : isComp ? '⚔️ Конкурент' : '';
            return `<a href="${href}" target="_blank" rel="noopener" title="${title}"
        style="display:inline-block;padding:2px 9px;border-radius:12px;font-size:12px;
               text-decoration:none;border:1px solid ${chipColor}44;color:${chipColor};
               background:${bg};transition:opacity .15s;"
        onmouseover="this.style.opacity='.7'" onmouseout="this.style.opacity='1'"
      >${domain}</a>`;
        }).join('');
    }

    function moveSourcesTop() {
        const leftContainer = getLeftContainer();
        const leftGptMsg = leftContainer?.querySelector('.FuturisGPTMessage');
        const leftGroupContent = leftGptMsg?.querySelector('.FuturisGPTMessage-GroupContent');
        if (leftGptMsg && leftGroupContent && !document.getElementById('alice-sources-top-left')) {
            const leftSources = getSourcesFromContainer(leftContainer);
            if (Object.keys(leftSources).length > 0) {
                const wrap = document.createElement('div');
                wrap.id = 'alice-sources-top-left';
                wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;padding:6px 0 10px;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:6px;';
                wrap.innerHTML = renderSourceChips(leftSources, C.leftColor);
                leftGptMsg.insertBefore(wrap, leftGroupContent);
            }
        }

        const rightContainer = getRightContainer();
        const rightContent = rightContainer?.querySelector('.FuturisGPTMessage-GroupContent');
        if (rightContent && !document.getElementById('alice-sources-top-right')) {
            const rightSources = getSourcesFromContainer(rightContainer);
            if (Object.keys(rightSources).length > 0) {
                const wrap = document.createElement('div');
                wrap.id = 'alice-sources-top-right';
                wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;padding:6px 0 10px;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:6px;';
                wrap.innerHTML = renderSourceChips(rightSources, C.rightColor);
                rightContent.insertBefore(wrap, rightContent.firstChild);
            }
        }
    }

    function refreshSourcesTop() {
        document.getElementById('alice-sources-top-left')?.remove();
        document.getElementById('alice-sources-top-right')?.remove();
        moveSourcesTop();
    }

    function metaRow(label, value, color = C.text, tooltip = '') {
        const tip = tooltip
            ? `title="${tooltip}" style="cursor:help;border-bottom:1px dashed ${C.muted}44;"`
            : '';
        return `<div style="display:flex;justify-content:space-between;align-items:center;
      padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
      <span ${tip} style="color:${C.muted};font-size:11px;${tooltip ? 'cursor:help;border-bottom:1px dashed ' + C.muted + '44' : ''}"
        ${tooltip ? 'title="' + tooltip + '"' : ''}>${label}</span>
      <span style="color:${color};font-weight:600;font-size:11px;text-align:right;max-width:55%;
        word-break:break-word">${value}</span>
    </div>`;
    }

    function sectionTitle(t, tooltip = '') {
        const tip = tooltip ? `title="${tooltip}" style="cursor:help;"` : '';
        return `<div style="font-size:10px;font-weight:700;color:${C.muted};text-transform:uppercase;
      letter-spacing:.8px;margin:10px 0 5px;padding-bottom:3px;
      border-bottom:1px solid ${C.border}">
      <span ${tip}>${t}</span>
    </div>`;
    }

    function colLabel(col) {
        const color = col === 'left' ? C.leftColor : C.rightColor;
        const icon = col === 'left' ? '◧' : '◨';
        return `<span style="color:${color};font-size:10px;font-weight:700">${icon} ${col === 'left' ? 'Лев.' : 'Прав.'}</span>`;
    }

    const btnBase = `cursor:pointer;border-radius:6px;border:1px solid ${C.border};
    background:rgba(255,255,255,0.04);color:${C.text};font-size:11px;
    transition:background .15s;padding:4px 7px;`;

    function showOverlay(titleText, contentHTML) {
        document.getElementById('alice-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'alice-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:1000001;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;';

        const modal = document.createElement('div');
        modal.style.cssText = `background:${C.bg};border:1px solid ${C.border};border-radius:12px;
      width:580px;max-height:82vh;display:flex;flex-direction:column;
      box-shadow:0 16px 48px rgba(0,0,0,.7);font-family:-apple-system,Arial,sans-serif;
      font-size:12px;color:${C.text};`;

        modal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;
        padding:11px 16px;border-bottom:1px solid ${C.border};background:${C.bgHeader};
        border-radius:12px 12px 0 0;flex-shrink:0">
        <span style="font-weight:700;color:${C.blue};font-size:13px">${titleText}</span>
        <button id="alice-overlay-close" style="${btnBase}padding:1px 8px;font-size:15px;">&times;</button>
      </div>
      <div style="overflow-y:auto;padding:12px 16px;flex-grow:1">${contentHTML}</div>
    `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        setTimeout(() => {
            document.getElementById('alice-overlay-close')?.addEventListener('click', () => overlay.remove());
        }, 50);
    }

    function showJournal() {
        const log = JSON.parse(GM_getValue('alice_v4_log', '[]'));

        document.getElementById('alice-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'alice-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:1000001;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;';

        const modal = document.createElement('div');
        modal.style.cssText = `
      background:${C.bg};border:1px solid ${C.border};border-radius:14px;
      width:860px;max-width:96vw;max-height:88vh;display:flex;flex-direction:column;
      box-shadow:0 24px 64px rgba(0,0,0,.8);
      font-family:-apple-system,Arial,sans-serif;color:${C.text};
    `;

        if (!log.length) {
            modal.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;
          padding:16px 22px;border-bottom:1px solid ${C.border};background:${C.bgHeader};border-radius:14px 14px 0 0">
          <span style="font-weight:700;color:${C.blue};font-size:15px">📖 Журнал запросов</span>
          <button id="alice-overlay-close" style="cursor:pointer;border-radius:7px;border:1px solid ${C.border};
            background:rgba(255,255,255,0.06);color:${C.text};font-size:18px;padding:2px 12px;line-height:1">&times;</button>
        </div>
        <div style="padding:40px;text-align:center;color:${C.muted};font-size:15px">Журнал пуст</div>`;
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
            setTimeout(() => document.getElementById('alice-overlay-close')?.addEventListener('click', () => overlay.remove()), 50);
            return;
        }

        const headHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;
        padding:16px 22px;border-bottom:1px solid ${C.border};background:${C.bgHeader};
        border-radius:14px 14px 0 0;flex-shrink:0">
        <div>
          <span style="font-weight:700;color:${C.blue};font-size:15px">📖 Журнал запросов</span>
          <span style="color:${C.muted};font-size:13px;margin-left:10px">${log.length} записей</span>
        </div>
        <button id="alice-overlay-close" style="cursor:pointer;border-radius:7px;border:1px solid ${C.border};
          background:rgba(255,255,255,0.06);color:${C.text};font-size:18px;padding:2px 12px;line-height:1">&times;</button>
      </div>`;

        const tableHead = `
      <div style="display:grid;grid-template-columns:90px 1fr 90px 80px 80px 60px;gap:8px;
        padding:10px 22px;border-bottom:2px solid ${C.border};
        font-size:11px;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:.7px;
        flex-shrink:0;background:${C.bgHeader}">
        <span>Дата</span>
        <span>Запрос</span>
        <span style="text-align:center">Мой сайт</span>
        <span style="text-align:center">Тип ответа</span>
        <span style="text-align:center">Источников</span>
        <span style="text-align:right">Экран</span>
      </div>`;

        const rows = log.slice(-80).reverse().map((e, i) => {
            const bg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';

            const leftOk = e.myInLeft ? `<span style="color:${C.green};font-size:15px">✅</span>`
                : e.hasLeft ? `<span style="color:${C.red};font-size:13px;font-weight:700">✗</span>`
                    : `<span style="color:${C.muted}">—</span>`;
            const rightOk = e.myInRight ? `<span style="color:${C.green};font-size:15px">✅</span>`
                : e.hasRight ? `<span style="color:${C.red};font-size:13px;font-weight:700">✗</span>`
                    : `<span style="color:${C.muted}">—</span>`;

            const screenPct = e.screenPercent || 0;
            const screenColor = screenPct > 70 ? C.red : screenPct > 40 ? C.orange : C.green;

            const srcCount = `${e.leftSourcesCount || 0} / ${e.rightSourcesCount || 0}`;
            const answerType = e.leftAnswerType || e.rightAnswerType || '—';

            return `
        <div style="display:grid;grid-template-columns:90px 1fr 90px 80px 80px 60px;gap:8px;
          align-items:center;padding:10px 22px;border-bottom:1px solid rgba(255,255,255,0.05);
          background:${bg};transition:background .1s"
          onmouseover="this.style.background='rgba(88,166,255,0.06)'"
          onmouseout="this.style.background='${bg}'">

          <span style="color:${C.muted};font-size:13px;white-space:nowrap">${e.date}</span>

          <span style="color:${C.text};font-size:13px;overflow:hidden;text-overflow:ellipsis;
            white-space:nowrap;line-height:1.4" title="${e.query.replace(/"/g, '&quot;')}">${e.query}</span>

          <div style="display:flex;justify-content:center;align-items:center;gap:6px;font-size:13px">
            <span title="Левая колонка">${leftOk}</span>
            <span style="color:${C.border}">|</span>
            <span title="Правая колонка">${rightOk}</span>
          </div>

          <span style="text-align:center;color:${C.purple};font-size:12px">${answerType}</span>

          <span style="text-align:center;color:${C.blue};font-size:13px;font-weight:600">${srcCount}</span>

          <span style="text-align:right;color:${screenColor};font-size:13px;font-weight:700">${screenPct}%</span>
        </div>`;
        }).join('');

        const legend = `
      <div style="padding:10px 22px;display:flex;gap:20px;font-size:12px;color:${C.muted};flex-wrap:wrap">
        <span><span style="color:${C.green}">✅</span> мой сайт в источниках</span>
        <span><span style="color:${C.red};font-weight:700">✗</span> блок есть, сайта нет</span>
        <span><span style="color:${C.muted}">—</span> блок отсутствует</span>
        <span>Источников: <b style="color:${C.blue}">лев. / прав.</b></span>
        <span>Экран: доля первого экрана занятая тизером Алисы</span>
      </div>`;

        const footer = `
      <div style="display:flex;gap:10px;padding:14px 22px;border-top:1px solid ${C.border};
        flex-shrink:0;background:${C.bgHeader};border-radius:0 0 14px 14px">
        <button id="al-journal-csv" style="cursor:pointer;border-radius:8px;border:1px solid ${C.border};
          background:rgba(88,166,255,0.1);color:${C.blue};font-size:13px;font-weight:600;
          padding:8px 20px;flex:1;transition:background .15s"
          onmouseover="this.style.background='rgba(88,166,255,0.2)'"
          onmouseout="this.style.background='rgba(88,166,255,0.1)'">
          ⬇ Скачать CSV
        </button>
        <button id="al-journal-copy" style="cursor:pointer;border-radius:8px;border:1px solid ${C.border};
          background:rgba(63,185,80,0.1);color:${C.green};font-size:13px;font-weight:600;
          padding:8px 20px;flex:1;transition:background .15s"
          onmouseover="this.style.background='rgba(63,185,80,0.2)'"
          onmouseout="this.style.background='rgba(63,185,80,0.1)'">
          📋 Копировать в буфер
        </button>
        <button id="al-journal-clear" style="cursor:pointer;border-radius:8px;
          border:1px solid ${C.red}55;background:rgba(248,81,73,0.08);color:${C.red};
          font-size:13px;font-weight:600;padding:8px 18px;transition:background .15s"
          onmouseover="this.style.background='rgba(248,81,73,0.18)'"
          onmouseout="this.style.background='rgba(248,81,73,0.08)'">
          🗑 Очистить журнал
        </button>
      </div>`;

        modal.innerHTML = headHtml +
            tableHead +
            `<div style="overflow-y:auto;flex-grow:1">${rows}</div>` +
            legend +
            footer;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

        setTimeout(() => {
            document.getElementById('alice-overlay-close')?.addEventListener('click', () => overlay.remove());

            document.getElementById('al-journal-csv')?.addEventListener('click', () => {
                const csv = '\uFEFF' + 'Дата,Запрос,Лев.Мой,Прав.Мой,Лев.Ист.,Прав.Ист.,Тип,Экран%\n' +
                    log.map(e =>
                        `"${e.date}","${e.query}","${e.myInLeft ? 'да' : 'нет'}","${e.myInRight ? 'да' : 'нет'}","` +
                        `"${e.leftSourcesCount || 0}","${e.rightSourcesCount || 0}","${e.leftAnswerType || ''}","${e.screenPercent || 0}"`
                    ).join('\n');
                GM_download({ url: 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv), name: 'alice-journal.csv' });
            });

            document.getElementById('al-journal-copy')?.addEventListener('click', function () {
                const text = log.slice(-80).reverse().map(e =>
                    `[${e.date}] Л:${e.myInLeft ? '✅' : '✗'} П:${e.myInRight ? '✅' : '✗'} | ` +
                    `${e.leftSourcesCount || 0}/${e.rightSourcesCount || 0} ист. | ${e.screenPercent || 0}% | "${e.query}"`
                ).join('\n');
                GM_setClipboard(text);
                flash(this, '✅ Скопировано!', '📋 Копировать в буфер');
            });

            document.getElementById('al-journal-clear')?.addEventListener('click', () => {
                if (confirm('Очистить весь журнал? Это действие нельзя отменить.')) {
                    GM_setValue('alice_v4_log', '[]');
                    overlay.remove();
                }
            });
        }, 80);
    }

    function showDomainStats() {
        const stats = JSON.parse(GM_getValue('alice_v4_stats', JSON.stringify({ left: {}, right: {} })));
        const leftSorted = Object.entries(stats.left || {}).sort((a, b) => b[1] - a[1]);
        const rightSorted = Object.entries(stats.right || {}).sort((a, b) => b[1] - a[1]);

        if (!leftSorted.length && !rightSorted.length) {
            showOverlay('📊 Топ доменов', `<div style="color:${C.muted};text-align:center;padding:24px">Нет данных</div>`);
            return;
        }

        function renderStatCol(sorted, color, label) {
            if (!sorted.length) return `<div style="color:${C.muted};text-align:center;padding:12px">—</div>`;
            const max = sorted[0][1];
            return sorted.slice(0, 20).map(([domain, count], i) => {
                const pct = Math.round(count / max * 100);
                const isMyDomain = settings.myDomains.some(p => domainMatches(domain, p));
                const isComp = settings.competitors.some(p => domainMatches(domain, p));
                const dc = isMyDomain ? C.green : isComp ? C.orange : color;
                return `<div style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
          <div style="display:flex;justify-content:space-between;margin-bottom:2px">
            <span style="color:${dc};font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:75%">
              ${i + 1}. ${domain}${isMyDomain ? ' ✅' : isComp ? ' ⚔️' : ''}
            </span>
            <span style="color:${C.muted};font-size:10px;flex-shrink:0">${count}×</span>
          </div>
          <div style="height:3px;border-radius:2px;background:${C.border}">
            <div style="height:3px;border-radius:2px;width:${pct}%;background:${dc}"></div>
          </div>
        </div>`;
            }).join('');
        }

        const html = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <div style="font-size:10px;font-weight:700;color:${C.leftColor};text-transform:uppercase;
            letter-spacing:.6px;margin-bottom:6px">◧ Левая колонка</div>
          ${renderStatCol(leftSorted, C.leftColor, 'left')}
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:${C.rightColor};text-transform:uppercase;
            letter-spacing:.6px;margin-bottom:6px">◨ Правая колонка</div>
          ${renderStatCol(rightSorted, C.rightColor, 'right')}
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:14px">
        <button id="al-stats-csv" style="${btnBase}flex:1;text-align:center">⬇ CSV</button>
        <button id="al-stats-clear" style="${btnBase}color:${C.red};border-color:${C.red}44">🗑 Сбросить</button>
      </div>`;

        showOverlay('📊 Топ доменов-источников', html);

        setTimeout(() => {
            document.getElementById('al-stats-csv')?.addEventListener('click', () => {
                const allDomains = new Set([...leftSorted.map(([d]) => d), ...rightSorted.map(([d]) => d)]);
                const rows = [...allDomains].map(d =>
                    `"${d}",${stats.left[d] || 0},${stats.right[d] || 0}`
                );
                const csv = '\uFEFF' + 'Домен,Левая,Правая\n' + rows.join('\n');
                GM_download({ url: 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv), name: 'alice-stats.csv' });
            });
            document.getElementById('al-stats-clear')?.addEventListener('click', () => {
                if (confirm('Сбросить статистику?')) {
                    GM_setValue('alice_v4_stats', JSON.stringify({ left: {}, right: {} }));
                    document.getElementById('alice-overlay')?.remove();
                }
            });
        }, 80);
    }

    function buildPanel(data) {
        if (document.getElementById('alice-seo-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'alice-seo-panel';
        panel.style.cssText = `
      position:fixed;
      ${settings.panelX !== null ? `left:${settings.panelX}px` : 'right:14px'};
      top:${settings.panelY !== null ? settings.panelY : 70}px;
      z-index:1000000;width:268px;
      background:${C.bg};border:1px solid ${C.border};border-radius:10px;
      box-shadow:0 8px 32px rgba(0,0,0,.6);
      font-family:-apple-system,Arial,sans-serif;font-size:12px;color:${C.text};
      user-select:none;`;

        const header = document.createElement('div');
        header.style.cssText = `display:flex;align-items:center;justify-content:space-between;
      padding:8px 12px;background:${C.bgHeader};border-radius:10px 10px 0 0;
      cursor:grab;border-bottom:1px solid ${C.border};`;
        header.innerHTML = `
      <span style="font-weight:700;font-size:12px;color:${C.blue}">🤖 Панель SEO для Алисы AI</span>
      <span id="alice-toggle" style="font-size:13px;color:${C.muted};cursor:pointer;padding:0 2px">▲</span>`;

        const body = document.createElement('div');
        body.id = 'alice-panel-body';
        body.style.cssText = `padding:8px 12px;max-height:88vh;overflow-y:auto;`;

        let collapsed = false;
        header.querySelector('#alice-toggle').addEventListener('click', e => {
            e.stopPropagation();
            collapsed = !collapsed;
            body.style.display = collapsed ? 'none' : 'block';
            header.querySelector('#alice-toggle').textContent = collapsed ? '▼' : '▲';
        });

        function sectionOverview() {
            const q = data.query;
            const myL = data.myInLeft.length > 0;
            const myR = data.myInRight.length > 0;
            const myOrgPos = data.myInOrganic.length > 0
                ? data.myInOrganic.map(r => '#' + r.pos).join(', ') : '—';

            const colBlock = (label, color, hasBlock, srcCount, answerType, myFound) => {
                if (!hasBlock) return `
          <div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
            <span style="color:${color};font-size:11px;font-weight:700">${label}</span>
            <span style="color:${C.muted};font-size:11px;margin-left:6px">блок отсутствует</span>
          </div>`;
                return `
          <div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
            <div style="color:${color};font-size:11px;font-weight:700;margin-bottom:4px">${label}</div>
            ${metaRow('Источников', srcCount, color, 'Число сайтов, которые Алиса использовала как источники для ответа')}
            ${metaRow('Тип ответа', answerType, C.purple, 'Формат ответа Алисы: текст, список, нумерованный список, структурированный (с заголовками) или таблица')}
            ${metaRow('Мой сайт', myFound ? '✅ Да' : '❌ Нет', myFound ? C.green : C.red, 'Найден ли ваш домен (из раздела «Мой сайт») среди источников этого блока')}
          </div>`;
            };

            return sectionTitle('📊 Обзор') +
                `<div style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
          <div style="color:${C.muted};font-size:10px;margin-bottom:2px" title="Текущий поисковый запрос">Запрос</div>
          <div style="color:${C.text};font-size:12px;font-weight:600;word-break:break-word;line-height:1.4">«${q}»</div>
        </div>` +
                colBlock('◧ Левая колонка', C.leftColor, data.leftContainer, data.leftSourcesCount, data.leftAnswerType, myL) +
                colBlock('◨ Правая колонка', C.rightColor, data.rightContainer, data.rightSourcesCount, data.rightAnswerType, myR) +
                metaRow('Органика', data.organic.length + ' позиций', C.blue, 'Количество обычных (не AI) результатов в выдаче') +
                metaRow('Мой сайт в органике', myOrgPos, myOrgPos !== '—' ? C.green : C.muted, 'Позиции вашего домена в обычной органической выдаче') +
                metaRow('Блок занимает экран', data.screenPercent + '%', data.screenPercent > 60 ? C.red : C.green, 'Какую долю первого экрана занимает тизер Алисы в левой колонке. Чем больше — тем меньше видно органики без прокрутки');
        }

        function sectionMyDomain() {
            return sectionTitle('🎯 Мой сайт', 'Введите ваш домен — скрипт будет подсвечивать его в источниках Алисы и отслеживать присутствие в выдаче') +
                `<div id="al-my-tags" style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:4px">
          ${renderTags(settings.myDomains, 'my', C.green)}
        </div>
        <div style="display:flex;gap:4px">
          <input id="al-my-input" type="text" placeholder="site.ru"
            style="flex:1;padding:4px 7px;border-radius:5px;border:1px solid ${C.border};
            background:${C.bgHeader};color:${C.text};font-size:11px;outline:none">
          <button id="al-my-add" style="${btnBase}padding:4px 8px">＋</button>
        </div>`;
        }

        function sectionCompetitors() {
            const compL = data.compInLeft.length;
            const compR = data.compInRight.length;
            return sectionTitle('⚔️ Конкуренты', 'Домены конкурентов — будут подсвечиваться оранжевым в источниках и отслеживаться в журнале') +
                `<div id="al-comp-tags" style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:4px">
          ${renderTags(settings.competitors, 'comp', C.orange)}
        </div>
        <div style="display:flex;gap:4px">
          <input id="al-comp-input" type="text" placeholder="competitor.ru"
            style="flex:1;padding:4px 7px;border-radius:5px;border:1px solid ${C.border};
            background:${C.bgHeader};color:${C.text};font-size:11px;outline:none">
          <button id="al-comp-add" style="${btnBase}padding:4px 8px">＋</button>
        </div>
        ${settings.competitors.length > 0 ? `
        <div style="margin-top:5px">
          ${metaRow('◧ В левой', compL > 0 ? data.compInLeft.join(', ') : '—', compL > 0 ? C.orange : C.muted,
                    'Конкуренты, найденные в источниках левого блока (тизер в основной выдаче)')}
          ${metaRow('◨ В правой', compR > 0 ? data.compInRight.join(', ') : '—', compR > 0 ? C.orange : C.muted,
                        'Конкуренты, найденные в источниках правого блока (карточка в сайдбаре)')}
        </div>` : ''}`;
        }

        function sectionIntersection() {
            const items = data.sourceInOrganic.slice(0, 6).map(r =>
                `<span style="color:${C.blue}">#${r.pos}</span> <span style="color:${C.muted}">${r.domain}</span>`
            ).join('  ');
            return sectionTitle('🔗 Источники в органике', 'Домены из источников Алисы, которые одновременно ранжируются в обычной выдаче на этой же странице') +
                metaRow('Совпадений', `${data.sourceInOrganic.length} из ${Math.max(data.leftSourcesCount, data.rightSourcesCount)}`, C.blue,
                    'Сколько доменов из источников Алисы одновременно присутствуют в обычной органической выдаче на этой же странице') +
                (data.sourceInOrganic.length > 0
                    ? `<div style="margin-top:3px;font-size:11px;line-height:1.8">${items}</div>`
                    : '');
        }

        function sectionRelated() {
            if (!data.related.length) return '';
            const lr = getLr();
            const previewCount = 3;
            const preview = data.related.slice(0, previewCount);
            const rest = data.related.slice(previewCount);

            const renderItem = q =>
                `<div style="padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.03)">
          <a href="/search/?text=${encodeURIComponent(q)}&lr=${lr}" target="_blank"
            style="color:${C.blue};text-decoration:none;font-size:11px;display:block;
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${q}">
            🔍 ${q}
          </a>
        </div>`;

            return sectionTitle(`💡 Люди ищут (${data.related.length})`, 'Похожие поисковые запросы из блока "Люди ищут" — полезны для расширения семантического ядра') +
                `<div id="al-related-preview">${preview.map(renderItem).join('')}</div>` +
                (rest.length > 0 ? `
          <div id="al-related-rest" style="display:none">${rest.map(renderItem).join('')}</div>
          <button id="al-related-toggle" style="${btnBase}width:100%;text-align:center;margin-top:4px">
            ▼ Ещё ${rest.length} запросов
          </button>` : '') +
                `<div style="display:flex;gap:4px;margin-top:6px">
          <button id="al-related-csv" style="${btnBase}flex:1;text-align:center">⬇ CSV</button>
          <button id="al-related-copy" style="${btnBase}flex:1;text-align:center">📋 Копировать</button>
        </div>`;
        }

        function sectionSources() {
            return sectionTitle('📤 Источники', 'Домены и URL, которые Алиса использовала как источники для формирования ответа. Левая и правая колонки могут различаться') +
                `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <div>
            <div style="font-size:10px;color:${C.leftColor};font-weight:700;
              margin-bottom:4px;text-align:center">◧ Левая (${data.leftSourcesCount})</div>
            <div style="display:flex;flex-direction:column;gap:3px">
              <button id="al-src-l-domains" style="${btnBase}text-align:center;width:100%"
                ${data.leftSourcesCount === 0 ? 'disabled style="' + btnBase + 'opacity:.4;cursor:default"' : ''}>
                📋 Домены</button>
              <button id="al-src-l-urls" style="${btnBase}text-align:center;width:100%"
                ${data.leftSourcesCount === 0 ? 'disabled style="' + btnBase + 'opacity:.4;cursor:default"' : ''}>
                📋 URLs</button>
              <button id="al-src-l-csv" style="${btnBase}text-align:center;width:100%"
                ${data.leftSourcesCount === 0 ? 'disabled style="' + btnBase + 'opacity:.4;cursor:default"' : ''}>
                ⬇ CSV</button>
            </div>
          </div>
          <div>
            <div style="font-size:10px;color:${C.rightColor};font-weight:700;
              margin-bottom:4px;text-align:center">◨ Правая (${data.rightSourcesCount})</div>
            <div style="display:flex;flex-direction:column;gap:3px">
              <button id="al-src-r-domains" style="${btnBase}text-align:center;width:100%"
                ${data.rightSourcesCount === 0 ? 'disabled style="' + btnBase + 'opacity:.4;cursor:default"' : ''}>
                📋 Домены</button>
              <button id="al-src-r-urls" style="${btnBase}text-align:center;width:100%"
                ${data.rightSourcesCount === 0 ? 'disabled style="' + btnBase + 'opacity:.4;cursor:default"' : ''}>
                📋 URLs</button>
              <button id="al-src-r-csv" style="${btnBase}text-align:center;width:100%"
                ${data.rightSourcesCount === 0 ? 'disabled style="' + btnBase + 'opacity:.4;cursor:default"' : ''}>
                ⬇ CSV</button>
            </div>
          </div>
        </div>`;
        }

        function sectionAnswer() {
            const hasL = !!getLeftContainer()?.querySelector('.FuturisGPTMessage-GroupContent');
            const hasR = !!getRightContainer()?.querySelector('.FuturisGPTMessage-GroupContent');
            return sectionTitle('✏️ Скопировать ответ', 'Копирует полный текст ответа Алисы с правильными переносами строк и заголовками') +
                `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <button id="al-copy-left" style="${btnBase}text-align:center;width:100%;
            ${!hasL ? 'opacity:.4;cursor:default;' : ''}"
            ${!hasL ? 'disabled' : ''}>
            📋 Левая</button>
          <button id="al-copy-right" style="${btnBase}text-align:center;width:100%;
            ${!hasR ? 'opacity:.4;cursor:default;' : ''}"
            ${!hasR ? 'disabled' : ''}>
            📋 Правая</button>
        </div>`;
        }

        function sectionDatabase() {
            return sectionTitle('🗃 База данных', 'Журнал: история всех запросов с отметками о присутствии вашего сайта. Топ доменов: статистика появлений в источниках Алисы накопленная по всем запросам') +
                `<div style="display:flex;gap:4px">
          <button id="al-show-log" style="${btnBase}flex:1;text-align:center">📖 Журнал</button>
          <button id="al-show-stats" style="${btnBase}flex:1;text-align:center">📊 Топ доменов</button>
        </div>`;
        }

        body.innerHTML =
            sectionOverview() +
            sectionMyDomain() +
            sectionCompetitors() +
            sectionIntersection() +
            sectionRelated() +
            sectionSources() +
            sectionAnswer() +
            sectionDatabase();

        panel.appendChild(header);
        panel.appendChild(body);
        document.body.appendChild(panel);

        makeDraggable(panel, header);

        bindAllEvents(data, body);
    }

    function renderTags(list, type, color) {
        return list.map((d, i) =>
            `<span style="display:inline-flex;align-items:center;gap:3px;padding:1px 7px;
        border-radius:10px;font-size:11px;background:${color}18;border:1px solid ${color}55;color:${color}">
        ${d}
        <span data-remove-${type}="${i}"
          style="cursor:pointer;color:${C.muted};font-size:13px;line-height:1;margin-left:1px">×</span>
      </span>`
        ).join('');
    }

    function redrawTags(body) {
        const myEl = body.querySelector('#al-my-tags');
        if (myEl) myEl.innerHTML = renderTags(settings.myDomains, 'my', C.green);
        const compEl = body.querySelector('#al-comp-tags');
        if (compEl) compEl.innerHTML = renderTags(settings.competitors, 'comp', C.orange);
        bindTagRemove(body);
    }

    function bindTagRemove(body) {
        body.querySelectorAll('[data-remove-my]').forEach(el => {
            el.addEventListener('click', e => {
                e.stopPropagation();
                settings.myDomains.splice(+el.getAttribute('data-remove-my'), 1);
                saveSettings(settings);
                redrawTags(body);
                refreshSourcesTop();
            });
        });
        body.querySelectorAll('[data-remove-comp]').forEach(el => {
            el.addEventListener('click', e => {
                e.stopPropagation();
                settings.competitors.splice(+el.getAttribute('data-remove-comp'), 1);
                saveSettings(settings);
                redrawTags(body);
                refreshSourcesTop();
            });
        });
    }

    function bindAllEvents(data, body) {

        bindTagRemove(body);

        function addMyDomain() {
            const inp = body.querySelector('#al-my-input');
            if (!inp?.value.trim()) return;
            const d = normalizeDomain(inp.value);
            if (d && !settings.myDomains.includes(d)) {
                settings.myDomains.push(d);
                saveSettings(settings);
                redrawTags(body);
                refreshSourcesTop();
            }
            inp.value = '';
        }
        body.querySelector('#al-my-add')?.addEventListener('click', addMyDomain);
        body.querySelector('#al-my-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') addMyDomain(); });
        body.querySelector('#al-my-input')?.addEventListener('blur', function () {
            if (this.value.trim()) this.value = normalizeDomain(this.value);
        });

        function addCompetitor() {
            const inp = body.querySelector('#al-comp-input');
            if (!inp?.value.trim()) return;
            const d = normalizeDomain(inp.value);
            if (d && !settings.competitors.includes(d)) {
                settings.competitors.push(d);
                saveSettings(settings);
                redrawTags(body);
                refreshSourcesTop();
            }
            inp.value = '';
        }
        body.querySelector('#al-comp-add')?.addEventListener('click', addCompetitor);
        body.querySelector('#al-comp-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') addCompetitor(); });
        body.querySelector('#al-comp-input')?.addEventListener('blur', function () {
            if (this.value.trim()) this.value = normalizeDomain(this.value);
        });

        body.querySelector('#al-related-toggle')?.addEventListener('click', function () {
            const rest = body.querySelector('#al-related-rest');
            if (!rest) return;
            const hidden = rest.style.display === 'none';
            rest.style.display = hidden ? 'block' : 'none';
            this.textContent = hidden ? '▲ Скрыть' : `▼ Ещё ${data.related.length - 3} запросов`;
        });

        body.querySelector('#al-related-csv')?.addEventListener('click', () => {
            const csv = '\uFEFF' + 'Запрос\n' + data.related.map(q => `"${q}"`).join('\n');
            GM_download({ url: 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv), name: `related-${getQuery().slice(0, 20)}.csv` });
        });

        body.querySelector('#al-related-copy')?.addEventListener('click', function () {
            GM_setClipboard(data.related.join('\n'));
            flash(this, '✅', '📋 Копировать');
        });

        body.querySelector('#al-src-l-domains')?.addEventListener('click', function () {
            GM_setClipboard(Object.keys(data.leftSources).join('\n'));
            flash(this, '✅', '📋 Домены');
        });
        body.querySelector('#al-src-l-urls')?.addEventListener('click', function () {
            GM_setClipboard(Object.values(data.leftSources).join('\n'));
            flash(this, '✅', '📋 URLs');
        });
        body.querySelector('#al-src-l-csv')?.addEventListener('click', () => {
            const csv = '\uFEFF' + 'Домен,URL\n' +
                Object.entries(data.leftSources).map(([d, u]) => `"${d}","${u}"`).join('\n');
            GM_download({ url: 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv), name: `sources-left-${getQuery().slice(0, 15)}.csv` });
        });

        body.querySelector('#al-src-r-domains')?.addEventListener('click', function () {
            GM_setClipboard(Object.keys(data.rightSources).join('\n'));
            flash(this, '✅', '📋 Домены');
        });
        body.querySelector('#al-src-r-urls')?.addEventListener('click', function () {
            GM_setClipboard(Object.values(data.rightSources).join('\n'));
            flash(this, '✅', '📋 URLs');
        });
        body.querySelector('#al-src-r-csv')?.addEventListener('click', () => {
            const csv = '\uFEFF' + 'Домен,URL\n' +
                Object.entries(data.rightSources).map(([d, u]) => `"${d}","${u}"`).join('\n');
            GM_download({ url: 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv), name: `sources-right-${getQuery().slice(0, 15)}.csv` });
        });

        body.querySelector('#al-copy-left')?.addEventListener('click', function () {
            const leftContainer = getLeftContainer();
            leftContainer?.querySelectorAll('[class*="collapsed"], [aria-expanded="false"]')
                .forEach(el => el.click());
            setTimeout(() => {
                const text = extractCleanText(leftContainer);
                if (text) {
                    GM_setClipboard(text);
                    flash(this, '✅ Скопировано!', '📋 Левая');
                } else {
                    flash(this, '⚠️ Пусто', '📋 Левая');
                }
            }, 300);
        });

        body.querySelector('#al-copy-right')?.addEventListener('click', function () {
            const rightContainer = getRightContainer();
            const showMoreBtn = rightContainer?.querySelector('button');
            if (showMoreBtn?.textContent?.includes('Показать')) showMoreBtn.click();
            setTimeout(() => {
                const text = extractCleanText(rightContainer);
                if (text) {
                    GM_setClipboard(text);
                    flash(this, '✅ Скопировано!', '📋 Правая');
                } else {
                    flash(this, '⚠️ Пусто', '📋 Правая');
                }
            }, 300);
        });

        body.querySelector('#al-show-log')?.addEventListener('click', showJournal);
        body.querySelector('#al-show-stats')?.addEventListener('click', showDomainStats);
    }

    function flash(btn, tempText, origText) {
        const orig = btn.textContent;
        btn.textContent = tempText;
        setTimeout(() => { btn.textContent = origText || orig; }, 1800);
    }

    function makeDraggable(panel, handle) {
        let dragging = false, ox, oy, sl, st;

        handle.addEventListener('mousedown', e => {
            if (e.target.id === 'alice-toggle') return;
            dragging = true;
            handle.style.cursor = 'grabbing';
            const r = panel.getBoundingClientRect();
            ox = e.clientX; oy = e.clientY;
            sl = r.left; st = r.top;
            panel.style.right = 'auto';
            panel.style.left = sl + 'px';
            panel.style.top = st + 'px';
            e.preventDefault();
        });

        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            const nL = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, sl + e.clientX - ox));
            const nT = Math.max(0, Math.min(window.innerHeight - 50, st + e.clientY - oy));
            panel.style.left = nL + 'px';
            panel.style.top = nT + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            handle.style.cursor = 'grab';
            settings.panelX = parseFloat(panel.style.left);
            settings.panelY = parseFloat(panel.style.top);
            saveSettings(settings);
        });
    }

    GM_registerMenuCommand('📖 Журнал запросов', showJournal);
    GM_registerMenuCommand('📊 Топ доменов-источников', showDomainStats);
    GM_registerMenuCommand('⬇ Экспорт журнала CSV', () => {
        const log = JSON.parse(GM_getValue('alice_v4_log', '[]'));
        if (!log.length) return;
        const csv = '\uFEFF' + 'Дата,Запрос,Лев.Мой,Прав.Мой,Лев.Ист.,Прав.Ист.,Тип,Экран%\n' +
            log.map(e => `"${e.date}","${e.query}","${e.myInLeft ? 'да' : 'нет'}","${e.myInRight ? 'да' : 'нет'}","${e.leftSourcesCount || 0}","${e.rightSourcesCount || 0}","${e.leftAnswerType || ''}","${e.screenPercent || 0}"`).join('\n');
        GM_download({ url: 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv), name: 'alice-journal.csv' });
    });
    GM_registerMenuCommand('🗑 Сбросить все данные', () => {
        if (confirm('Очистить журнал, статистику и настройки?')) {
            GM_setValue('alice_v4_log', '[]');
            GM_setValue('alice_v4_stats', JSON.stringify({ left: {}, right: {} }));
            GM_setValue('alice_v4_settings', '{}');
            location.reload();
        }
    });

    let initialized = false;

    function init() {
        if (initialized || !hasAliceBlock()) return;
        initialized = true;

        setTimeout(() => {
            const data = analyze();
            if (data) buildPanel(data);
            moveSourcesTop();
        }, 1200);

        let sourcesCheckCount = 0;
        const sourcesObserver = new MutationObserver(() => {
            const leftHasSources = !!document.querySelector(
                'li[data-fast-name="neuro_answer"] .FuturisGPTMessage-GroupSources, ' +
                'li[class*="futuris-snippet"] .FuturisGPTMessage-GroupSources'
            );
            const rightHasSources = !!document.querySelector('.EntityCard .FuturisGPTMessage-GroupSources');

            const leftChips = document.getElementById('alice-sources-top-left');
            const rightChips = document.getElementById('alice-sources-top-right');

            if ((leftHasSources && !leftChips) || (rightHasSources && !rightChips)) {
                moveSourcesTop();
            }

            sourcesCheckCount++;
            if (sourcesCheckCount > 30) sourcesObserver.disconnect();
        });
        sourcesObserver.observe(document.body, { childList: true, subtree: true });

        let retryCount = 0;
        const retryInterval = setInterval(() => {
            retryCount++;
            moveSourcesTop();
            if (retryCount >= 5) clearInterval(retryInterval);
        }, 1500);
    }

    new MutationObserver(() => { if (!initialized) init(); })
        .observe(document.body, { childList: true, subtree: true });

    init();

})();
