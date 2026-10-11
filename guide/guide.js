// ========== SHARED GUIDE MODAL FUNCTIONALITY ==========
function initializeGuideModal() {
    const guideBtn = document.getElementById('guideBtn');
    const guideClose = document.getElementById('guideClose');
    const guideModal = document.getElementById('guideModal');
    const tocCards = document.querySelectorAll('.guide-toc-card');
    const backButtons = document.querySelectorAll('.guide-back-btn');

    if (guideBtn) {
        guideBtn.addEventListener('click', openGuide);
    }

    if (guideClose) {
        guideClose.addEventListener('click', closeGuide);
    }

    if (guideModal) {
        guideModal.addEventListener('click', function (e) {
            if (e.target === guideModal) {
                closeGuide();
            }
        });
    }

    // TOC Card click handlers
    tocCards.forEach(card => {
        card.addEventListener('click', function () {
            const sectionNum = this.getAttribute('data-section');
            showGuideSection(sectionNum);
        });
    });

    // Back button click handlers
    backButtons.forEach(btn => {
        btn.addEventListener('click', function () {
            showGuideToc();
        });
    });
}

function openGuide() {
    const guideModal = document.getElementById('guideModal');
    if (guideModal) {
        guideModal.classList.add('active');
        document.body.style.overflow = 'hidden';
        showGuideToc();
    }
}

function closeGuide() {
    const guideModal = document.getElementById('guideModal');
    if (guideModal) {
        guideModal.classList.remove('active');
        document.body.style.overflow = '';
        showGuideToc();
    }
}

function showGuideToc() {
    const guideTocPage = document.getElementById('guideTocPage');
    const sectionPages = document.querySelectorAll('.guide-section-page');

    sectionPages.forEach(page => {
        page.classList.remove('active');
    });

    if (guideTocPage) {
        guideTocPage.classList.remove('hidden');
    }
}

function showGuideSection(sectionNum) {
    const guideTocPage = document.getElementById('guideTocPage');
    const sectionPages = document.querySelectorAll('.guide-section-page');
    const targetSection = document.getElementById('guideSection' + sectionNum);

    if (guideTocPage) {
        guideTocPage.classList.add('hidden');
    }

    sectionPages.forEach(page => {
        page.classList.remove('active');
    });

    if (targetSection) {
        targetSection.classList.add('active');
        targetSection.scrollTop = 0;
    }
}

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initializeGuideModal);
