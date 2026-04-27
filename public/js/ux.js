(function () {
    const PREFERS_REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const HAS_HOVER = window.matchMedia('(hover: hover)').matches;

    function ensureStylesheet() {
        if (document.querySelector('link[data-ux-css]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/css/components/ux.css';
        link.setAttribute('data-ux-css', '');
        document.head.appendChild(link);
    }

    function initReveal() {
        if (PREFERS_REDUCED || !('IntersectionObserver' in window)) return;

        const selectors = [
            '.section',
            '.creator-banner',
            '.hero-content > *',
            '.about-content > *',
            '[data-reveal]'
        ].join(', ');

        const targets = Array.from(document.querySelectorAll(selectors));
        if (!targets.length) return;

        targets.forEach((el, i) => {
            if (el.closest('.navbar, .nav-menu-mobile')) return;
            el.classList.add('ux-reveal');
            el.style.transitionDelay = Math.min(i * 40, 240) + 'ms';
        });

        const obs = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('ux-reveal--visible');
                    obs.unobserve(entry.target);
                }
            });
        }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

        targets.forEach((el) => {
            if (el.classList.contains('ux-reveal')) obs.observe(el);
        });
    }

    function initCursorGlow() {
        if (!HAS_HOVER) return;

        const targets = document.querySelectorAll('.creator-banner, .auth-card, [data-glow]');
        targets.forEach((el) => {
            el.classList.add('ux-glow');
            el.addEventListener('pointermove', (e) => {
                const rect = el.getBoundingClientRect();
                const mx = ((e.clientX - rect.left) / rect.width) * 100;
                const my = ((e.clientY - rect.top) / rect.height) * 100;
                el.style.setProperty('--ux-mx', mx + '%');
                el.style.setProperty('--ux-my', my + '%');
            });
        });
    }

    function initTopProgress() {
        const bar = document.createElement('div');
        bar.className = 'ux-topbar';
        const fill = document.createElement('div');
        fill.className = 'ux-topbar__fill';
        bar.appendChild(fill);
        document.body.appendChild(bar);

        let active = false;
        let pct = 0;
        let trickleTimer = null;

        function set(p) {
            pct = Math.max(0, Math.min(100, p));
            fill.style.right = (100 - pct) + '%';
        }

        function start() {
            if (active) return;
            active = true;
            bar.classList.remove('ux-topbar--done');
            fill.style.opacity = '1';
            set(0);
            requestAnimationFrame(() => set(20));
            trickleTimer = setInterval(() => {
                if (pct < 90) set(pct + Math.random() * 8);
            }, 300);
        }

        function done() {
            if (!active) return;
            clearInterval(trickleTimer);
            set(100);
            bar.classList.add('ux-topbar--done');
            active = false;
        }

        document.addEventListener('click', (e) => {
            const a = e.target.closest('a');
            if (!a) return;
            const href = a.getAttribute('href');
            if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
            if (a.target === '_blank' || a.hasAttribute('download')) return;
            try {
                const url = new URL(a.href, location.href);
                if (url.origin !== location.origin) return;
                if (url.pathname === location.pathname && url.search === location.search) return;
            } catch (_) { return; }
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            start();
        });

        window.addEventListener('pageshow', done);
        window.addEventListener('beforeunload', () => { fill.style.opacity = '1'; });

        window.uxProgress = { start, done };
    }

    function initButtons() {
        const buttons = document.querySelectorAll('.btn');
        buttons.forEach((btn) => {
            if (HAS_HOVER && !PREFERS_REDUCED) {
                let raf = null;
                btn.addEventListener('pointermove', (e) => {
                    const rect = btn.getBoundingClientRect();
                    const cx = rect.left + rect.width / 2;
                    const cy = rect.top + rect.height / 2;
                    const dx = (e.clientX - cx) * 0.18;
                    const dy = (e.clientY - cy) * 0.25;
                    if (raf) cancelAnimationFrame(raf);
                    raf = requestAnimationFrame(() => {
                        btn.style.transform = `translate(${dx}px, ${dy}px)`;
                    });
                });
                btn.addEventListener('pointerleave', () => {
                    if (raf) cancelAnimationFrame(raf);
                    btn.style.transform = '';
                });
            }

            btn.addEventListener('pointerdown', (e) => {
                const rect = btn.getBoundingClientRect();
                const ripple = document.createElement('span');
                ripple.className = 'ux-ripple';
                const size = Math.max(rect.width, rect.height) * 1.2;
                ripple.style.width = ripple.style.height = size + 'px';
                ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
                ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
                btn.appendChild(ripple);
                setTimeout(() => ripple.remove(), 600);
            });
        });
    }

    function scorePassword(pw) {
        if (!pw) return 0;
        let score = 0;
        if (pw.length >= 6) score++;
        if (pw.length >= 10) score++;
        const variety = [/[a-z]/.test(pw), /[A-Z]/.test(pw), /\d/.test(pw), /[^A-Za-z0-9]/.test(pw)].filter(Boolean).length;
        if (variety >= 2) score++;
        if (variety >= 3 && pw.length >= 8) score++;
        if (pw.length >= 14 && variety >= 3) score = Math.max(score, 4);
        return Math.min(4, score);
    }

    const STRENGTH_LABEL = ['', 'Weak', 'Fair', 'Good', 'Strong'];

    function validate(input) {
        const value = input.value;
        if (input.required && !value.trim()) return 'Required';
        if (input.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Invalid email';
        if (input.minLength > 0 && value && value.length < input.minLength) return `At least ${input.minLength} characters`;
        if (input.dataset.match) {
            const other = document.getElementById(input.dataset.match);
            if (other && value && value !== other.value) return 'Does not match';
        }
        return '';
    }

    function initForms() {
        const groups = document.querySelectorAll('.form-group');
        groups.forEach((group) => {
            const input = group.querySelector('input');
            const label = group.querySelector('label');
            if (!input || !label) return;
            if (group.dataset.uxNoFloat === '') return;

            group.classList.add('ux-field');
            input.placeholder = ' ';
            if (input.value) group.classList.add('ux-field--filled');

            if (input.parentElement === group) {
                group.appendChild(input);
                group.appendChild(label);
            }

            const validIcon = document.createElement('span');
            validIcon.className = 'ux-field__icon ux-field__icon--valid';
            validIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
            const invalidIcon = document.createElement('span');
            invalidIcon.className = 'ux-field__icon ux-field__icon--invalid';
            invalidIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
            group.appendChild(validIcon);
            group.appendChild(invalidIcon);

            const feedback = document.createElement('div');
            feedback.className = 'ux-field__feedback';
            feedback.setAttribute('aria-live', 'polite');
            group.appendChild(feedback);

            let touched = false;

            function refresh() {
                if (input.value) group.classList.add('ux-field--filled');
                else group.classList.remove('ux-field--filled');

                if (!touched && !input.value) {
                    group.classList.remove('ux-field--valid', 'ux-field--invalid');
                    feedback.textContent = '';
                    return;
                }

                const err = validate(input);
                if (err) {
                    group.classList.add('ux-field--invalid');
                    group.classList.remove('ux-field--valid');
                    feedback.textContent = err;
                } else {
                    group.classList.remove('ux-field--invalid');
                    if (input.value) group.classList.add('ux-field--valid');
                    else group.classList.remove('ux-field--valid');
                    feedback.textContent = '';
                }
            }

            input.addEventListener('blur', () => { touched = true; refresh(); });
            input.addEventListener('input', refresh);

            if (input.id === 'password' || (input.type === 'password' && !/confirm/i.test(input.name || '') && !/confirm/i.test(input.id || ''))) {
                if (input.minLength > 0 || input.dataset.strength !== undefined) {
                    const meter = document.createElement('div');
                    meter.className = 'ux-pw-meter';
                    meter.setAttribute('data-strength', '0');
                    const segs = document.createElement('div');
                    segs.className = 'ux-pw-meter__bar';
                    for (let i = 0; i < 4; i++) {
                        const s = document.createElement('span');
                        s.className = 'ux-pw-meter__seg';
                        segs.appendChild(s);
                    }
                    const lbl = document.createElement('span');
                    lbl.className = 'ux-pw-meter__label';
                    meter.appendChild(segs);
                    meter.appendChild(lbl);
                    group.appendChild(meter);

                    input.addEventListener('input', () => {
                        const s = scorePassword(input.value);
                        meter.setAttribute('data-strength', String(s));
                        lbl.textContent = STRENGTH_LABEL[s] || '';
                    });
                }
            }
        });

        const confirm = document.getElementById('confirmPassword');
        const pw = document.getElementById('password');
        if (confirm && pw && !confirm.dataset.match) {
            confirm.dataset.match = 'password';
            pw.addEventListener('input', () => {
                if (confirm.value) confirm.dispatchEvent(new Event('input'));
            });
        }
    }

    function initCommandPalette() {
        const overlay = document.createElement('div');
        overlay.className = 'ux-cmd-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', 'Command palette');
        overlay.innerHTML = `
            <div class="ux-cmd">
                <div class="ux-cmd__search">
                    <span class="ux-cmd__icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
                    </span>
                    <input type="text" class="ux-cmd__input" placeholder="Search pages or actions...">
                    <span class="ux-cmd__hint">ESC</span>
                </div>
                <ul class="ux-cmd__list" role="listbox"></ul>
                <div class="ux-cmd__footer">
                    <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
                    <span><kbd>↵</kbd> select</span>
                    <span><kbd>Esc</kbd> close</span>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const input = overlay.querySelector('.ux-cmd__input');
        const list = overlay.querySelector('.ux-cmd__list');

        const navIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

        function collectItems() {
            const seen = new Set();
            const items = [];
            const navLinks = document.querySelectorAll('.navbar a, .nav-menu-mobile a');
            navLinks.forEach((a) => {
                const href = a.getAttribute('href');
                const label = (a.textContent || '').trim();
                if (!href || !label) return;
                const key = href + '|' + label.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                items.push({ label, href, kind: 'page' });
            });
            return items;
        }

        let items = [];
        let filtered = [];
        let activeIndex = 0;

        function render(query) {
            const q = (query || '').trim().toLowerCase();
            filtered = !q ? items : items.filter((it) => it.label.toLowerCase().includes(q) || it.href.toLowerCase().includes(q));
            list.innerHTML = '';
            if (!filtered.length) {
                const empty = document.createElement('div');
                empty.className = 'ux-cmd__empty';
                empty.textContent = 'No results';
                list.appendChild(empty);
                return;
            }
            filtered.forEach((it, i) => {
                const li = document.createElement('li');
                li.className = 'ux-cmd__item' + (i === activeIndex ? ' ux-cmd__item--active' : '');
                li.setAttribute('role', 'option');
                li.innerHTML = `<span class="ux-cmd__item-icon">${navIcon}</span><span>${escapeHtml(it.label)}</span>`;
                li.addEventListener('click', () => go(it));
                li.addEventListener('mouseenter', () => {
                    activeIndex = i;
                    updateActive();
                });
                list.appendChild(li);
            });
        }

        function updateActive() {
            list.querySelectorAll('.ux-cmd__item').forEach((el, i) => {
                el.classList.toggle('ux-cmd__item--active', i === activeIndex);
                if (i === activeIndex) el.scrollIntoView({ block: 'nearest' });
            });
        }

        function go(item) {
            close();
            if (window.uxProgress) window.uxProgress.start();
            window.location.href = item.href;
        }

        function open() {
            items = collectItems();
            activeIndex = 0;
            input.value = '';
            render('');
            overlay.classList.add('ux-cmd-overlay--open');
            setTimeout(() => input.focus(), 30);
            document.body.style.overflow = 'hidden';
        }

        function close() {
            overlay.classList.remove('ux-cmd-overlay--open');
            document.body.style.overflow = '';
        }

        input.addEventListener('input', () => {
            activeIndex = 0;
            render(input.value);
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        document.addEventListener('keydown', (e) => {
            const isOpen = overlay.classList.contains('ux-cmd-overlay--open');
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                if (isOpen) close();
                else open();
                return;
            }
            if (!isOpen) return;
            if (e.key === 'Escape') { e.preventDefault(); close(); }
            else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (filtered.length) { activeIndex = (activeIndex + 1) % filtered.length; updateActive(); }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (filtered.length) { activeIndex = (activeIndex - 1 + filtered.length) % filtered.length; updateActive(); }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (filtered[activeIndex]) go(filtered[activeIndex]);
            }
        });

        window.uxCommandPalette = { open, close };
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function init() {
        ensureStylesheet();
        initTopProgress();
        initReveal();
        initCursorGlow();
        initButtons();
        initForms();
        initCommandPalette();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
