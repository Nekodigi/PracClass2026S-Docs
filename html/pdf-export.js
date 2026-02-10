/**
 * PDF Export Module — OLIENT TECH Lecture Documents
 * ==================================================
 * jsPDF + html2canvas で表紙 + 各 .page を個別キャプチャし
 * A4 PDF を生成する。
 *
 * 改善点:
 * - フルスクリーンオーバーレイで画面のチラつきを防止
 * - プログレスバー + ページ番号表示 (5 / 12)
 * - 白ページ検出・スキップ
 * - エラー時の安全なリストア
 */
(function () {
  'use strict';

  var JSPDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  var H2C_CDN   = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';

  /* ---- Helpers ---- */

  function loadScript(url) {
    return new Promise(function (ok, fail) {
      if (url.indexOf('jspdf') !== -1 && window.jspdf) return ok();
      if (url.indexOf('html2canvas') !== -1 && window.html2canvas) return ok();
      var s = document.createElement('script');
      s.src = url; s.onload = ok; s.onerror = fail;
      document.head.appendChild(s);
    });
  }

  function waitImages() {
    return Promise.all(
      Array.from(document.querySelectorAll('img')).map(function (img) {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise(function (ok) {
          img.onload = ok; img.onerror = ok;
          setTimeout(ok, 5000);
        });
      })
    );
  }

  /* ================================================================
     Progress Overlay — covers entire viewport to hide flickering
     ================================================================ */
  var _overlay = null;
  var _progressBar = null;
  var _progressText = null;
  var _statusText = null;

  function showOverlay() {
    _overlay = document.createElement('div');
    _overlay.style.cssText =
      'position:fixed;inset:0;z-index:999999;' +
      'background:#0f172a;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'font-family:"Noto Sans JP",sans-serif;color:#fff;';

    // Title
    var title = document.createElement('div');
    title.textContent = 'PDF を生成しています';
    title.style.cssText = 'font-size:16pt;font-weight:700;margin-bottom:32px;letter-spacing:1px;';
    _overlay.appendChild(title);

    // Progress bar container
    var barOuter = document.createElement('div');
    barOuter.style.cssText =
      'width:360px;height:8px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;';
    _progressBar = document.createElement('div');
    _progressBar.style.cssText =
      'width:0%;height:100%;background:linear-gradient(90deg,#2563eb,#60a5fa);' +
      'border-radius:4px;transition:width 0.3s ease;';
    barOuter.appendChild(_progressBar);
    _overlay.appendChild(barOuter);

    // Page counter (e.g. "5 / 12 ページ")
    _progressText = document.createElement('div');
    _progressText.style.cssText =
      'margin-top:16px;font-size:14pt;font-weight:600;letter-spacing:0.5px;' +
      'font-variant-numeric:tabular-nums;';
    _progressText.textContent = '';
    _overlay.appendChild(_progressText);

    // Status text
    _statusText = document.createElement('div');
    _statusText.style.cssText =
      'margin-top:8px;font-size:9pt;color:rgba(255,255,255,0.45);letter-spacing:1px;';
    _statusText.textContent = '準備中…';
    _overlay.appendChild(_statusText);

    document.documentElement.appendChild(_overlay);
  }

  function updateProgress(current, total, status) {
    if (_progressBar) {
      var pct = Math.round((current / total) * 100);
      _progressBar.style.width = pct + '%';
    }
    if (_progressText) {
      _progressText.textContent = current + ' / ' + total + ' ページ';
    }
    if (_statusText && status) {
      _statusText.textContent = status;
    }
  }

  function hideOverlay() {
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _progressBar = null;
    _progressText = null;
    _statusText = null;
  }

  /* ---- Capture one element to canvas ---- */
  function capture(el, opts) {
    return html2canvas(el, Object.assign({
      scale:           2,
      useCORS:         true,
      allowTaint:      true,
      letterRendering: true,
      logging:         false,
      backgroundColor: '#ffffff',
      scrollX: 0, scrollY: 0,
    }, opts || {}));
  }

  /* ---- Check if canvas is essentially blank (all white) ---- */
  function isBlankCanvas(canvas) {
    var ctx = canvas.getContext('2d');
    // Sample a grid of 20 points across the canvas
    var step = Math.max(1, Math.floor(canvas.width / 5));
    var stepY = Math.max(1, Math.floor(canvas.height / 4));
    for (var x = step; x < canvas.width; x += step) {
      for (var y = stepY; y < canvas.height; y += stepY) {
        var px = ctx.getImageData(x, y, 1, 1).data;
        // If any pixel is not near-white, it's not blank
        if (px[0] < 250 || px[1] < 250 || px[2] < 250) {
          return false;
        }
      }
    }
    return true;
  }

  /* ---- Save / Restore inline styles ---- */
  function save(el) { return el.style.cssText; }
  function restore(el, css) { el.style.cssText = css; }

  /* ================================================================
     exportPDF — main entry point
     ================================================================ */
  window.exportPDF = async function (filename) {
    showOverlay();

    // Saved styles for safe cleanup
    var savedStyles = [];
    var origHtml, origBody;

    try {
      /* 1. Load libraries + wait for images */
      if (_statusText) _statusText.textContent = 'ライブラリを読み込み中…';
      await Promise.all([loadScript(JSPDF_CDN), loadScript(H2C_CDN), waitImages()]);
      window.scrollTo(0, 0);

      /* 2. Hide screen-only chrome */
      document.querySelectorAll('.no-print, .viewer-bar').forEach(function (el) {
        savedStyles.push({ el: el, prev: el.style.display });
        el.style.display = 'none';
      });

      /* 3. Prepare body for flat rendering */
      origHtml = save(document.documentElement);
      origBody = save(document.body);
      document.documentElement.style.background = '#ffffff';
      document.body.style.background = '#ffffff';
      document.body.style.maxWidth   = 'none';
      document.body.style.margin     = '0';
      document.body.style.padding    = '0';

      /* A4 constants */
      var PW = 210, PH = 297;
      var A4_PX_W = 794;
      var A4_PX_H = 1123;

      var { jsPDF } = window.jspdf;
      var pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      var needsNewPage = false;

      /* Count total pages for progress */
      var cover = document.querySelector('.cover-page');
      var pages = document.querySelectorAll('.doc-body .page');
      // .page が無い場合、各 .doc-body / .chapter-page を出現順にページとして扱う
      if (pages.length === 0) pages = document.querySelectorAll('.doc-body, .chapter-page');
      var totalPages = (cover ? 1 : 0) + pages.length;

      /* ========== Cover page (full-bleed) ========== */
      if (cover) {
        updateProgress(1, totalPages, '表紙をレンダリング中…');

        var origCover = save(cover);
        cover.style.width     = A4_PX_W + 'px';
        cover.style.minHeight = A4_PX_H + 'px';
        cover.style.height    = A4_PX_H + 'px';
        cover.style.margin    = '0';
        cover.style.overflow  = 'hidden';

        var cvs = await capture(cover, { backgroundColor: null });
        restore(cover, origCover);

        pdf.addImage(cvs.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, PW, PH);
        needsNewPage = true;
      }

      /* ========== Content pages ========== */
      // キャプチャ中は角丸を全面除去（CSS変数をゼロにして全要素に波及させる）
      var captureStyle = document.createElement('style');
      captureStyle.textContent =
        ':root{--radius-default:0!important}' +
        '*,*::before,*::after{border-radius:0!important}';
      document.head.appendChild(captureStyle);

      if (pages.length > 0) {
        for (var i = 0; i < pages.length; i++) {
          var pageIdx = (cover ? 2 : 1) + i;
          updateProgress(pageIdx, totalPages, 'ページ ' + pageIdx + ' をレンダリング中…');

          var page = pages[i];
          var origPage = save(page);
          page.style.width        = A4_PX_W + 'px';
          page.style.height       = A4_PX_H + 'px';
          page.style.minHeight    = A4_PX_H + 'px';
          page.style.maxHeight    = 'none';
          page.style.overflow     = 'hidden';
          page.style.margin       = '0';
          page.style.boxShadow    = 'none';
          page.style.borderRadius = '0';
          page.style.background   = '#ffffff';

          // doc-body をページとしてキャプチャする場合、
          // padding を .page と揃えて doc-header の負マージンと整合させる
          if (page.classList.contains('doc-body')) {
            page.style.padding = '68px 60px 83px 60px';
          }

          var pageCvs = await capture(page);
          restore(page, origPage);

          // Skip blank pages
          if (isBlankCanvas(pageCvs)) {
            continue;
          }

          if (needsNewPage) pdf.addPage();
          needsNewPage = true;

          pdf.addImage(
            pageCvs.toDataURL('image/jpeg', 0.92),
            'JPEG', 0, 0, PW, PH
          );
        }
      } else {
        /* ---- Legacy layout: capture doc-body and slice ---- */
        var MT = 18, MR = 16, MB = 22, ML = 16;
        var CW = PW - ML - MR;
        var CH = PH - MT - MB;

        var docBody = document.querySelector('.doc-body');
        if (docBody) {
          updateProgress(1, 1, '本文をレンダリング中…');

          var origDoc = save(docBody);
          docBody.style.background    = '#ffffff';
          docBody.style.boxShadow     = 'none';
          docBody.style.borderRadius  = '0';
          docBody.style.margin        = '0';
          docBody.style.padding       = '24px 32px';
          docBody.style.width         = A4_PX_W + 'px';

          var breaks = docBody.querySelectorAll('section.page-break');
          var origBreaks = [];
          breaks.forEach(function (s) {
            origBreaks.push(save(s));
            s.style.marginTop  = '28px';
            s.style.paddingTop = '0';
            s.style.borderTop  = 'none';
          });

          var cats = docBody.querySelectorAll('.category-section');
          var origCats = [];
          cats.forEach(function (c) {
            origCats.push(save(c));
            c.style.boxShadow = 'none';
          });

          var bodyCanvas = await capture(docBody);

          restore(docBody, origDoc);
          breaks.forEach(function (s, idx) { restore(s, origBreaks[idx]); });
          cats.forEach(function (c, idx)   { restore(c, origCats[idx]); });

          var pxPerMM2    = bodyCanvas.width / CW;
          var pageHeightPx = CH * pxPerMM2;
          var totalHeight  = bodyCanvas.height;
          var y            = 0;
          var pageNum      = 0;
          var legacyTotal  = Math.ceil(totalHeight / pageHeightPx);

          while (y < totalHeight) {
            if (needsNewPage) pdf.addPage();
            needsNewPage = true;
            pageNum++;
            updateProgress(pageNum + (cover ? 1 : 0), legacyTotal + (cover ? 1 : 0),
              'ページ ' + pageNum + ' を処理中…');

            var sliceH = Math.min(pageHeightPx, totalHeight - y);
            var slice = document.createElement('canvas');
            slice.width  = bodyCanvas.width;
            slice.height = Math.ceil(sliceH);
            var ctx = slice.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, slice.width, slice.height);
            ctx.drawImage(
              bodyCanvas,
              0, Math.floor(y), bodyCanvas.width, Math.ceil(sliceH),
              0, 0, bodyCanvas.width, Math.ceil(sliceH)
            );

            var imgH2 = sliceH / pxPerMM2;
            pdf.addImage(
              slice.toDataURL('image/jpeg', 0.92),
              'JPEG', ML, MT, CW, imgH2
            );

            y += pageHeightPx;
          }
        }
      }

      /* ========== Restore & Save ========== */
      captureStyle.remove();
      restore(document.documentElement, origHtml);
      restore(document.body, origBody);
      savedStyles.forEach(function (h) { h.el.style.display = h.prev; });

      if (_statusText) _statusText.textContent = 'PDF を保存中…';
      if (_progressBar) _progressBar.style.width = '100%';
      pdf.save(filename || 'document.pdf');

    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('PDF生成に失敗しました:\n' + err.message +
            '\n\n代替手段: python generate_pdfs.py を実行してください。');
    } finally {
      /* Safety restore */
      if (origHtml !== undefined) restore(document.documentElement, origHtml);
      if (origBody !== undefined) restore(document.body, origBody);
      document.querySelectorAll('.no-print, .viewer-bar').forEach(function (el) {
        el.style.removeProperty('display');
      });
      savedStyles.forEach(function (h) { h.el.style.display = h.prev; });
      hideOverlay();
    }
  };
})();
