/* ============================================================
   "I Will Be Attending" — Photo Template Generator
   Plain client-side JS. No backend, no persistence.
   ============================================================ */

(function () {
  "use strict";

  /* ---------------- Constants ---------------- */

  var TEMPLATE_SRC = "assets/ATTENDANCE_TEMPLATE.png";
  var CANVAS_SIZE = 2160;

  // Photo box as % of template size (keeps working if the asset
  // is swapped for another 1:1 render).
  var PHOTO_BOX_PCT = {
    left: 60.463,
    top: 28.38,
    width: 30.972
  };

  // Derived pixel geometry at native resolution.
  var BOX = {
    x: Math.round((CANVAS_SIZE * PHOTO_BOX_PCT.left) / 100),   // 1306
    y: Math.round((CANVAS_SIZE * PHOTO_BOX_PCT.top) / 100),    // 613
    size: Math.round((CANVAS_SIZE * PHOTO_BOX_PCT.width) / 100) // 669
  };
  var BORDER_BOTTOM_Y = BOX.y + BOX.size + 2; // outer edge of the black border (~1284)

  // Name text styling.
  var NAME_COLOR = "#0A1F44";
  var FONT_STACK = "'Poppins', 'Segoe UI', system-ui, -apple-system, sans-serif";
  var BASE_FONT_SIZE = 46;
  var MIN_FONT_SIZE = 34;
  var FONT_SHRINK_FACTOR = 0.9;
  var MAX_LINES_BEFORE_SHRINK = 3;
  var LINE_HEIGHT_RATIO = 1.2;
  var FIRST_LINE_GAP = 26; // px below BORDER_BOTTOM_Y

  var DOWNLOAD_PREFIX = "RYE-Bootcamp-Cohort2-";

  var ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

  /* ---------------- DOM refs ---------------- */

  var canvas = document.getElementById("previewCanvas");
  var ctx = canvas.getContext("2d");

  var dropzone = document.getElementById("dropzone");
  var photoInput = document.getElementById("photoInput");
  var fileError = document.getElementById("fileError");
  var recropBtn = document.getElementById("recropBtn");
  var replaceBtn = document.getElementById("replaceBtn");

  var nameInput = document.getElementById("nameInput");

  var downloadBtn = document.getElementById("downloadBtn");
  var downloadHint = document.getElementById("downloadHint");

  var cropModal = document.getElementById("cropModal");
  var cropImage = document.getElementById("cropImage");
  var confirmCropBtn = document.getElementById("confirmCropBtn");
  var cancelCropBtn = document.getElementById("cancelCropBtn");
  var zoomInBtn = document.getElementById("zoomInBtn");
  var zoomOutBtn = document.getElementById("zoomOutBtn");

  /* ---------------- State ---------------- */

  var templateImage = null;
  var croppedCanvas = null; // confirmed crop result (drawn into the box)
  var originalDataUrl = null; // last uploaded photo (for re-cropping)
  var cropper = null;

  /* ---------------- Template loading ---------------- */

  function loadTemplate() {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () {
        reject(new Error("Could not load the template image from " + TEMPLATE_SRC));
      };
      img.src = TEMPLATE_SRC;
    });
  }

  /* ---------------- Compositing ---------------- */

  function wrapText(text, maxWidth, fontSize) {
    ctx.font = "bold " + fontSize + "px " + FONT_STACK;
    var words = text.trim().split(/\s+/);
    var lines = [];
    var current = "";

    for (var i = 0; i < words.length; i++) {
      var candidate = current ? current + " " + words[i] : words[i];
      if (ctx.measureText(candidate).width <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function fitNameLines(name) {
    var size = BASE_FONT_SIZE;
    var lines = wrapText(name, BOX.size, size);

    // Auto-shrink slightly to avoid excessive wrapping.
    while (
      lines.length > MAX_LINES_BEFORE_SHRINK &&
      size > MIN_FONT_SIZE
    ) {
      size *= FONT_SHRINK_FACTOR;
      if (size < MIN_FONT_SIZE) size = MIN_FONT_SIZE;
      lines = wrapText(name, BOX.size, size);
    }
    return { lines: lines, fontSize: Math.round(size * 10) / 10 };
  }

  function drawName() {
    var name = nameInput.value.trim();
    if (!name) return;

    var fitted = fitNameLines(name);
    ctx.font = "bold " + fitted.fontSize + "px " + FONT_STACK;
    ctx.fillStyle = NAME_COLOR;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    var centerX = BOX.x + BOX.size / 2;
    var y = BORDER_BOTTOM_Y + FIRST_LINE_GAP;
    var step = fitted.fontSize * LINE_HEIGHT_RATIO;

    for (var i = 0; i < fitted.lines.length; i++) {
      ctx.fillText(fitted.lines[i], centerX, y);
      y += step;
    }
  }

  function drawComposite() {
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // 1. Template fills the whole background first...
    if (templateImage) {
      ctx.drawImage(templateImage, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }

    // 2. ...then the photo is drawn ON TOP, only inside the inner
    //    white rect. The destination stops exactly at the border,
    //    so the black border stays crisp.
    if (croppedCanvas) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(croppedCanvas, BOX.x, BOX.y, BOX.size, BOX.size);
    }

    drawName();
  }

  /* ---------------- UI state ---------------- */

  function updateUiState() {
    var hasPhoto = !!croppedCanvas;
    var hasName = nameInput.value.trim().length > 0;
    var ready = hasPhoto && hasName;

    downloadBtn.disabled = !ready;
    downloadHint.textContent = ready
      ? "All set — your card will export as a full-resolution PNG."
      : !hasPhoto && !hasName
        ? "Upload a photo and enter your name to enable the download."
        : !hasPhoto
          ? "Upload a photo to enable the download."
          : "Enter your name to enable the download.";

    recropBtn.hidden = !originalDataUrl;
    replaceBtn.hidden = !originalDataUrl;
  }

  function redraw() {
    drawComposite();
    updateUiState();
  }

  /* ---------------- File handling ---------------- */

  function showFileError(message) {
    fileError.textContent = message;
    fileError.hidden = false;
  }

  function clearFileError() {
    fileError.hidden = true;
    fileError.textContent = "";
  }

  function handleFile(file) {
    if (!file) return;

    if (ACCEPTED_TYPES.indexOf(file.type) === -1) {
      showFileError("Unsupported file type. Please choose a JPG, PNG or WebP image.");
      return;
    }
    clearFileError();

    var reader = new FileReader();
    reader.onload = function () {
      openCropModal(reader.result);
    };
    reader.onerror = function () {
      showFileError("Could not read that file. Please try another image.");
    };
    reader.readAsDataURL(file);
  }

  /* ---------------- Crop modal / Cropper.js ---------------- */

  function openCropModal(dataUrl) {
    originalDataUrl = dataUrl; // keep for re-cropping
    cropImage.src = dataUrl;

    cropModal.hidden = false;
    document.body.style.overflow = "hidden";

    // Wait until the <img> actually has its bitmap before init.
    cropImage.onload = function () {
      if (cropper) {
        cropper.destroy();
        cropper = null;
      }
      cropper = new Cropper(cropImage, {
        aspectRatio: 1, // destination box is square
        viewMode: 1,
        dragMode: "move",
        autoCropArea: 1,
        background: false,
        zoomable: true,
        zoomOnWheel: true,
        zoomOnTouch: true,
        movable: true,
        responsive: true
      });
    };
  }

  function closeCropModal() {
    if (cropper) {
      cropper.destroy();
      cropper = null;
    }
    cropModal.hidden = true;
    document.body.style.overflow = "";
  }

  function confirmCrop() {
    if (!cropper) return;

    // Render the selection at up to 2x the destination size so the
    // final downscale into the 669x669 rect stays smooth.
    croppedCanvas = cropper.getCroppedCanvas({
      width: BOX.size * 2,
      height: BOX.size * 2,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
      fillColor: "#ffffff"
    });

    closeCropModal();
    redraw();
  }

  /* ---------------- Download ---------------- */

  function slugify(text) {
    return text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // strip accents
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function downloadPng() {
    if (downloadBtn.disabled) return;

    var slug = slugify(nameInput.value) || "attendee";
    var filename = DOWNLOAD_PREFIX + slug + ".png";

    canvas.toBlob(function (blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }, "image/png");
  }

  /* ---------------- Event wiring ---------------- */

  photoInput.addEventListener("change", function () {
    handleFile(this.files && this.files[0]);
    this.value = ""; // allow re-selecting the same file later
  });

  ["dragenter", "dragover"].forEach(function (evtName) {
    dropzone.addEventListener(evtName, function (e) {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(function (evtName) {
    dropzone.addEventListener(evtName, function (e) {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });
  dropzone.addEventListener("drop", function (e) {
    handleFile(e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  recropBtn.addEventListener("click", function () {
    if (originalDataUrl) openCropModal(originalDataUrl);
  });
  replaceBtn.addEventListener("click", function () {
    photoInput.click();
  });

  nameInput.addEventListener("input", redraw);

  confirmCropBtn.addEventListener("click", confirmCrop);
  cancelCropBtn.addEventListener("click", closeCropModal);
  zoomInBtn.addEventListener("click", function () {
    if (cropper) cropper.zoom(0.1);
  });
  zoomOutBtn.addEventListener("click", function () {
    if (cropper) cropper.zoom(-0.1);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !cropModal.hidden) closeCropModal();
  });

  downloadBtn.addEventListener("click", downloadPng);

  /* ---------------- Init ---------------- */

  loadTemplate()
    .then(function (img) {
      templateImage = img;
      return document.fonts.ready;
    })
    .then(redraw)
    .catch(function (err) {
      console.error(err.message);
      showFileError(err.message);
      redraw();
    });
})();
