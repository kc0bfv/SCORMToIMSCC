<script setup lang="ts">
import { ref } from 'vue';
import JSZip from 'jszip';
import { generateIMSCCManifest, createSimpleCourseConfig, downloadManifest } from './lib/imscc-generator-vite';

import type { IMSCCResource, IMSCCItem } from './lib/imscc-generator-vite';

// ============================================================================
// Type Definitions
// ============================================================================

/** Represents an image/media asset entry from SCORM's data.js assetLib array */
interface SCORMAsset {
    id: number;
    url: string;
    width?: number;
    height?: number;
    imageType?: string;
}

/** An extracted image file ready to be included in the IMSCC output zip */
interface SlideImageFile {
    assetId: number;
    filename: string;      // safe filename used in the output zip (e.g. "3_photo.jpg")
    data: Uint8Array;      // raw binary content
}
type JSONTree = any;
declare global {
    // Note the capital "W"
    interface Window {
        globalProvideData: any;
        JSZip: any;
    }
}
interface KnownSlide {
    displaytext: string;
}
interface RawResource {
    slideId: string;
    content: string;
}

// ============================================================================
// Image Asset Helper Functions
// ============================================================================

const IMAGE_EXTENSION_REGEX = /(\.png|\.jpg|\.jpeg|\.gif|\.svg)$/i;

/**
 * Determines whether a SCORM asset is a meaningful content image worth including.
 * Filters out: non-image files, tiny UI icons (<=100px), and Shape-prefixed UI elements.
 */
function isValidImageAsset(asset: SCORMAsset | undefined): asset is SCORMAsset {
    if ( !asset || typeof asset.url !== "string" ) { return false; }
    const normalized_url = asset.url.toLowerCase();
    if ( !IMAGE_EXTENSION_REGEX.test(normalized_url) ) { return false; }
    const base_name = normalized_url.split("/").pop() ?? "";
    if ( base_name.startsWith("shape") ) { return false; }
    // Filter out Articulate's text-rendering artifacts (e.g. "txt__default_5k4Hror0RqN.png")
    if ( base_name.startsWith("txt_") ) { return false; }
    const width = typeof asset.width === "number" ? asset.width : Number(asset.width);
    const height = typeof asset.height === "number" ? asset.height : Number(asset.height);
    if ( Number.isFinite(width) && width <= 100 ) { return false; }
    if ( Number.isFinite(height) && height <= 100 ) { return false; }
    return true;
}

/** Generates a unique output filename for an asset, prefixed with its ID to avoid collisions. */
function getSafeFilename(asset: SCORMAsset): string {
    const base_name_raw = asset.url?.split("/").pop() ?? `asset_${asset.id}`;
    if ( base_name_raw.toLowerCase().startsWith("asset_")) {
        return `${asset.id}_${base_name_raw}`;
    }
    return `${asset.id}_${base_name_raw}`;
}

/** Appends <img> tags for slide images below the existing notes HTML content. */
function appendImagesToContent(content: string, imagePaths: string[]): string {
    if ( !imagePaths.length ) { return content; }
    const images_html = imagePaths.map((path) => `<img src="${path}" alt="Slide image" />`).join("\n");
    return `${content}\n<div class="slide-images">\n${images_html}\n</div>`;
}

/**
 * Maps a slideRef ID (e.g. "SceneId.SlideId") to the format used in notesData.
 * Tries the full ID first, then falls back to just the last segment after the dot.
 */
function normalizeSlideRefId(refId: string | undefined, known_slides: Record<string, KnownSlide>): string | undefined {
    if ( !refId ) { return undefined; }
    if ( refId in known_slides ) { return refId; }
    const parts = refId.split(".");
    const last_part = parts.length ? parts[parts.length - 1] : refId;
    if ( last_part && last_part in known_slides ) { return last_part; }
    return last_part || refId;
}

/**
 * Given an asset URL, produces a list of candidate file paths to try when
 * extracting from the SCORM zip. Images may live in story_content/ or mobile/.
 */
function createCandidatePaths(url: string): string[] {
    const normalized = url.replace(/^\.\//, "").replace(/^\//, "");
    const candidates = new Set<string>();
    candidates.add(url);
    candidates.add(normalized);
    if ( !normalized.startsWith("story_content/") ) {
        candidates.add(`story_content/${normalized}`);
    }
    if ( !normalized.startsWith("mobile/") ) {
        candidates.add(`mobile/${normalized}`);
    }
    return Array.from(candidates).filter((path) => !!path);
}

/** Safely extracts the asset array from the SCORM data, handling possible structure variations. */
function extractAssetCandidates(assetLib: JSONTree): SCORMAsset[] {
    if ( Array.isArray(assetLib) ) { return assetLib; }
    if ( assetLib && Array.isArray(assetLib.assets) ) { return assetLib.assets; }
    if ( assetLib && Array.isArray(assetLib.records) ) { return assetLib.records; }
    return [];
}

// ============================================================================
// SCORM Metadata Parsing
// ============================================================================

const filter_shared_images = ref(true);

// ============================================================================
// User-Visible Log Messages
// ============================================================================

interface LogEntry {
    level: 'info' | 'warn' | 'error';
    text: string;
}

const log_messages = ref<LogEntry[]>([]);

/** Adds a message to the on-page log (and also to the browser console). */
function logMessage(level: 'info' | 'warn' | 'error', text: string) {
    log_messages.value.push({ level, text });
    if ( level === 'error' ) { console.error(text); }
    else if ( level === 'warn' ) { console.warn(text); }
    else { console.log(text); }
}

/** Clears all log messages (called at the start of each conversion). */
function clearLog() {
    log_messages.value = [];
}

/** Extracts the project title and author name from the SCORM meta.xml file. */
function getModuleData(meta_xml: string) : [ string, string ] {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(meta_xml, "text/xml");
    const errorNode = xmlDoc.querySelector("parsererror");
    if (errorNode) {
        logMessage('error', "Error parsing XML: " + (errorNode.textContent ?? ""));
        return ["Failed Getting Project", "Failed Getting Author"];
    }

    const project = xmlDoc.getElementsByTagName("project")[0];
    const author = xmlDoc.getElementsByTagName("author")[0];
    
    let title = project ? project.getAttribute("title") : undefined;
    let author_name = author ? author.getAttribute("name") : undefined;

    title = title ? title : "Title Not Found";
    author_name = author_name ? author_name : "Author Not Found";

    return [ title, author_name ];
}

// ============================================================================
// Slide Navigation Tree Parsing
// ============================================================================

/**
 * Recursively walks the SCORM navigation outline tree to build a map of
 * slide IDs to their display titles. Only slides in this outline are
 * considered "known" and included in the IMSCC output.
 */
function recursive_GKS(inlink: JSONTree, known_slides: Record<string, KnownSlide>)
    : Record<string, KnownSlide>
{
    try {
        const slideid = inlink.slideid.slice(8);
        known_slides[slideid] = { "displaytext": inlink.displaytext };
        if ( inlink.links ) {
            for ( const link of inlink.links ) {
                known_slides = recursive_GKS(link, known_slides);
            }
        }
    } catch (error) {
        logMessage('warn', `Error in recursive_GKS, continuing: ${error}`);
    }
    return known_slides;
}

/** Parses the frame data's navigation outline into a map of known slide IDs → titles. */
function getKnownSlides(frame_data: JSONTree) : Record<string, KnownSlide> | undefined {
  var known_slides : Record<string, KnownSlide> = {};

  if ( !( frame_data && frame_data.navData
    && frame_data.navData.outline && frame_data.navData.outline.links
    && Array.isArray(frame_data.navData.outline.links) ) )
  {
    logMessage('error', "Invalid frame_data structure — cannot extract slide info.");
    return;
  }

  for ( const link of frame_data.navData.outline.links ) {
    known_slides = recursive_GKS(link, known_slides);
  }

  return known_slides;
}

// ============================================================================
// Main Conversion Handler
// ============================================================================

/**
 * Main entry point: triggered when the user selects a SCORM zip file.
 * 1. Reads metadata (title, author) from meta.xml
 * 2. Parses the navigation outline and slide notes from frame.js
 * 3. Parses asset/image data from data.js
 * 4. Extracts image binaries and associates them with slides
 * 5. Builds the IMSCC manifest + HTML files + images and triggers download
 */
async function handleFileChange(event: Event) {
  clearLog();

  if ( ! event.target ) { logMessage('error', "Invalid event target."); return; }

  const input_event = (event.target as HTMLInputElement);
  if ( !input_event.files || input_event.files.length != 1 ) {
    logMessage('error', "Only select one file."); return;
  }

  const input_file = input_event.files?.[0];
  if ( !input_file ) { logMessage('error', "File select error."); return; }

  const zip_input = await JSZip.loadAsync(input_file);
  if ( !zip_input ) { logMessage('error', "Failed to load SCORM zip."); return; }

  // --- Step 1: Extract module metadata (title, author) from meta.xml ---
  const meta_xml = await zip_input.file("meta.xml")?.async("string");
  if ( !meta_xml ) { logMessage('error', "Failed to load meta.xml from SCORM package."); return; }

  const module_data = getModuleData(meta_xml);
  if ( ! module_data ) {
    logMessage('error', "Failed to retrieve module data from meta.xml.");
    return;
  }

  const module_name = module_data[0];
  const author = module_data[1];

  // --- Step 2: Parse frame.js for navigation outline + slide notes ---
  const frame_file_content = await zip_input.file("html5/data/js/frame.js")?.async("string");
  if ( !frame_file_content ) { logMessage('error', "Failed to load frame.js from SCORM package."); return; }

  // Articulate's JS files call globalProvideData() to register data by name.
  // We intercept that call and stash the data for later parsing.
  // This is a ridiculous, insecure implementation of what I'm doing, but *shrug*
  window.globalProvideData = (nm: string, dat: string) : undefined => {
    window.globalProvideData[nm] = dat;
  };
  eval(frame_file_content);

  const frame_data = JSON.parse(window.globalProvideData["frame"]);

  const known_slides = getKnownSlides(frame_data);
  if ( ! known_slides ) {
    logMessage('error', "Failed to extract known slides from navigation outline.");
    return;
  }

  // --- Step 3: Parse data.js for the image asset library and slide→asset mappings ---
  // data.js contains assetLib (all images/media) and slideMap.slideRefs
  // (which assets each slide uses). This is optional — text-only conversion
  // still works if data.js is missing or unparseable.
  let scorm_data: JSONTree | undefined = undefined;
  try {
    const data_file = zip_input.file("html5/data/js/data.js");
    if ( data_file ) {
      const data_file_content = await data_file.async("string");
      eval(data_file_content);
      const scorm_data_raw = window.globalProvideData["data"];
      if ( scorm_data_raw ) {
        scorm_data = JSON.parse(scorm_data_raw);
      } else {
        logMessage('warn', "SCORM data payload missing after evaluating data.js — images will not be included.");
      }
    } else {
      logMessage('warn', "Could not locate data.js in the SCORM package — images will not be included.");
    }
  } catch (error) {
    logMessage('error', `Error parsing SCORM data from data.js: ${error}`);
  }

  // --- Step 4: Filter slide notes to only include known (navigable) slides ---
  const resources_raw = frame_data.notesData.map(
    (dat: JSONTree) : RawResource | undefined =>
      {
        if ( dat.slideId in known_slides ) {
            return {
                "slideId": dat.slideId,
                "content": dat.content,    
            };
        } else {
            return undefined;
        }
      }
  ).filter( (val: RawResource | undefined) : boolean =>
    {
      return val !== undefined;
    }
  );

  // --- Step 5: Extract and associate images with slides ---
  // Build an asset map (assetId → asset metadata), then walk slideRefs to find
  // which images belong to which slides. Extract the image binaries from the
  // SCORM zip, cache them to avoid re-reading duplicates, and append <img> tags
  // to each slide's HTML content.
  const included_slide_ids = new Set(resources_raw.map((resource: RawResource) => resource.slideId));
  const assetBinaryCache = new Map<number, SlideImageFile>();
  const resourceImagePaths: Record<number, string[]> = {};

  if ( scorm_data ) {
    // Build assetId → asset metadata map
    const asset_candidates = extractAssetCandidates(scorm_data.assetLib ?? []);
    const asset_map = new Map<number, SCORMAsset>();
    asset_candidates.forEach((asset_candidate: SCORMAsset) => {
      if ( typeof asset_candidate?.id === "number" && typeof asset_candidate?.url === "string" ) {
        asset_map.set(asset_candidate.id, asset_candidate);
      }
    });

    const slide_refs = Array.isArray(scorm_data.slideMap?.slideRefs)
      ? scorm_data.slideMap.slideRefs
      : [];

    // slideId → list of extracted image files for that slide
    const slideImageFilesMap: Record<string, SlideImageFile[]> = {};

    /** Tries multiple candidate paths to extract an image binary from the SCORM zip. */
    const loadAssetBinary = async (asset: SCORMAsset): Promise<SlideImageFile | undefined> => {
      const candidate_paths = createCandidatePaths(asset.url);
      for ( const path of candidate_paths ) {
        const file_entry = zip_input.file(path);
        if ( !file_entry ) { continue; }
        try {
          const data = await file_entry.async("uint8array");
          return {
            assetId: asset.id,
            filename: getSafeFilename(asset),
            data,
          };
        } catch (file_error) {
          logMessage('warn', `Failed to read asset at ${path}: ${file_error}`);
        }
      }
      logMessage('warn', `Unable to locate image file for: ${asset.url}`);
      return undefined;
    };

    // Walk each slideRef, resolve its assets, extract binaries, and associate with slides
    for ( const slideRef of slide_refs ) {
      if ( !slideRef || typeof slideRef !== "object" ) { continue; }
      const normalizedSlideId = normalizeSlideRefId(slideRef.id, known_slides);
      if ( !normalizedSlideId || !included_slide_ids.has(normalizedSlideId) ) { continue; }
      if ( !Array.isArray(slideRef.assetIds) ) { continue; }
      for ( const assetId of slideRef.assetIds ) {
        const asset = asset_map.get(assetId);
        if ( !isValidImageAsset(asset) ) { continue; }
        let cached = assetBinaryCache.get(asset.id);
        if ( !cached ) {
          cached = await loadAssetBinary(asset);
          if ( !cached ) { continue; }
          assetBinaryCache.set(asset.id, cached);
        }
        if ( !slideImageFilesMap[normalizedSlideId] ) {
          slideImageFilesMap[normalizedSlideId] = [];
        }
        slideImageFilesMap[normalizedSlideId].push(cached);
      }
    }

    // --- Step 5b: Filter out shared template/chrome images ---
    // Images that appear on more than half the slides are almost certainly
    // shared UI elements (logos, backgrounds, nav graphics), not slide-specific
    // content. Count how many slides reference each asset and remove the
    // ubiquitous ones. This filter can be disabled via checkbox in the UI.
    const totalSlideCount = Object.keys(slideImageFilesMap).length;
    if ( filter_shared_images.value && totalSlideCount > 1 ) {
      const assetSlideCount = new Map<number, number>();
      for ( const images of Object.values(slideImageFilesMap) ) {
        const seen = new Set<number>();
        for ( const img of images ) {
          if ( !seen.has(img.assetId) ) {
            seen.add(img.assetId);
            assetSlideCount.set(img.assetId, (assetSlideCount.get(img.assetId) ?? 0) + 1);
          }
        }
      }
      const threshold = totalSlideCount / 2;
      const chromeAssetIds = new Set<number>();
      for ( const [assetId, count] of assetSlideCount ) {
        if ( count > threshold ) {
          chromeAssetIds.add(assetId);
        }
      }
      if ( chromeAssetIds.size > 0 ) {
        logMessage('info', `Filtering out ${chromeAssetIds.size} shared template image(s) that appear on >${Math.round(threshold)} of ${totalSlideCount} slides.`);
        for ( const slideId of Object.keys(slideImageFilesMap) ) {
          slideImageFilesMap[slideId] = (slideImageFilesMap[slideId] ?? []).filter(
            (img) => !chromeAssetIds.has(img.assetId)
          );
        }
        // Also remove filtered images from the binary cache so they don't
        // end up in the output zip
        for ( const assetId of chromeAssetIds ) {
          assetBinaryCache.delete(assetId);
        }
      }
    }

    // Append <img> tags to each slide's HTML and track image paths per resource
    resources_raw.forEach((dat: RawResource, index: number) => {
      const slideImages = slideImageFilesMap[dat.slideId] ?? [];
      const imagePaths = Array.from(new Set(slideImages.map((img) => `images/${img.filename}`)));
      if ( imagePaths.length ) {
        dat.content = appendImagesToContent(dat.content, imagePaths);
      }
      resourceImagePaths[index] = imagePaths;
    });
  } else {
    resources_raw.forEach((_: RawResource, index: number) => {
      resourceImagePaths[index] = [];
    });
  }

  // --- Step 6: Build IMSCC resource and item definitions ---
  // Each resource lists its HTML file plus any associated image files.
  const resources = resources_raw.map( (dat: RawResource, index: number) : IMSCCResource => {
    const additionalFiles = resourceImagePaths[index] ?? [];
    return {
        identifier: `resource_${index}`,
        type: "webcontent",
        files: [ `resource_${index}.html`, ...additionalFiles ]
    };
  });
  
  const items = resources_raw.map( (dat: RawResource, index: number) : IMSCCItem => {
    const ks = known_slides[dat.slideId];
    const title_obj = ks ? ks : {"displaytext": "Undefined slide display text"};
    return {
      identifier: `item_${index}`,
      identifierref: `resource_${index}`,
      title: title_obj.displaytext,
    };
  });

  // --- Step 7: Generate the IMSCC manifest XML ---
  const config = createSimpleCourseConfig(
    module_name,
    module_name,
    author,
    module_name,
    items,
    resources
  );

  const manifest = generateIMSCCManifest(config);
  
  //downloadManifest(manifest, `imsmanifest.xml`);

  // --- Step 8: Assemble the output IMSCC zip ---
  // Includes: imsmanifest.xml, per-slide HTML files, and extracted images.
  const outzip = new JSZip();
  outzip.file("imsmanifest.xml", manifest);

  resources_raw.forEach( (dat: RawResource, index: number) => {
    outzip.file(`resource_${index}.html`, dat.content);
  });

  // Add all extracted images under images/ directory
  assetBinaryCache.forEach((image) => {
    outzip.file(`images/${image.filename}`, image.data);
  });

  // --- Step 9: Trigger browser download of the IMSCC file ---
  const imageCount = assetBinaryCache.size;
  const slideCount = resources_raw.length;
  logMessage('info', `Conversion complete: ${slideCount} slide(s), ${imageCount} image(s) included. Downloading CourseFile.imscc...`);

  const blob = await outzip.generateAsync({type:"blob"})
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = "CourseFile.imscc";
  
  // Trigger download
  document.body.appendChild(a);
  a.click();
  
  // Cleanup
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

</script>

<template>
  <div class="app-wrapper">
    <!-- Header bar -->
    <header class="app-header">
      <div class="header-inner">
        <h1 class="app-title">SCORM to IMSCC Converter</h1>
        <span class="header-subtitle">Articulate Storyline → Coursera Import</span>
      </div>
    </header>

    <!-- Main content -->
    <main class="app-main">
      <div class="card">
        <h2 class="card-heading">Upload SCORM Package</h2>
        <p class="card-description">
          Select a SCORM zip file exported from Articulate Storyline.
          The converter will extract slide content and images into an
          IMSCC file you can import into Coursera.
        </p>
        <p class="card-description card-privacy">
          All processing happens entirely in your browser &mdash; no data is uploaded to any server.
        </p>

        <div class="file-input-group">
          <label for="infile" class="file-label">SCORM Package (.zip)</label>
          <input
            id="infile"
            type="file"
            accept=".zip"
            class="file-input"
            @change="(event) => { void handleFileChange(event); }"
            @click="(event) => {
              if ( ! event ) { return; }
              (event.target as HTMLInputElement).value = '';
            }"
          >
        </div>

        <div class="option-group">
          <label for="filter-shared" class="option-label">
            <input
              id="filter-shared"
              type="checkbox"
              v-model="filter_shared_images"
              class="option-checkbox"
            >
            Filter out shared template images (logos, backgrounds, etc.)
          </label>
        </div>
      </div>

      <!-- Log output -->
      <div v-if="log_messages.length > 0" class="card log-card">
        <h2 class="card-heading">Conversion Log</h2>
        <div class="log-area">
          <p
            v-for="(entry, index) in log_messages"
            :key="index"
            :class="['log-entry', 'log-' + entry.level]"
          >
            <span class="log-icon" v-if="entry.level === 'error'">✕</span>
            <span class="log-icon" v-else-if="entry.level === 'warn'">⚠</span>
            <span class="log-icon" v-else>✓</span>
            {{ entry.text }}
          </p>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="app-footer">
      <a href="https://github.com/kc0bfv/SCORMToIMSCC" target="_blank" rel="noopener">Source Code on GitHub</a>
    </footer>
  </div>
</template>

<style scoped>
/* ============================================================
   WarU / DAU-inspired theme
   Navy (#1b2a4a), Gold (#c5a44e), Clean white content
   ============================================================ */

/* Reset & base */
.app-wrapper {
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    color: #1b2a4a;
    background: #eef1f5;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    margin: 0;
}

/* ---------- Header ---------- */
.app-header {
    background: #1b2a4a;
    color: #ffffff;
    padding: 0;
    box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    border-bottom: 4px solid #c5a44e;
}
.header-inner {
    max-width: 760px;
    margin: 0 auto;
    padding: 1.25rem 1.5rem;
    display: flex;
    align-items: baseline;
    gap: 1rem;
    flex-wrap: wrap;
}
.app-title {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0;
    letter-spacing: 0.02em;
}
.header-subtitle {
    font-size: 0.9rem;
    color: #c5a44e;
    font-weight: 400;
}

/* ---------- Main content ---------- */
.app-main {
    max-width: 760px;
    width: 100%;
    margin: 2rem auto;
    padding: 0 1.5rem;
    flex: 1;
}

/* ---------- Cards ---------- */
.card {
    background: #ffffff;
    border: 1px solid #d0d5dd;
    border-radius: 6px;
    padding: 1.5rem 1.75rem;
    margin-bottom: 1.25rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.card-heading {
    font-size: 1.15rem;
    font-weight: 600;
    color: #1b2a4a;
    margin: 0 0 0.75rem 0;
    padding-bottom: 0.5rem;
    border-bottom: 2px solid #c5a44e;
}
.card-description {
    font-size: 0.92rem;
    line-height: 1.55;
    color: #3d4f6f;
    margin: 0 0 0.75rem 0;
}
.card-privacy {
    font-style: italic;
    color: #6b7a94;
    font-size: 0.85rem;
}

/* ---------- File input ---------- */
.file-input-group {
    margin-top: 1rem;
}
.file-label {
    display: block;
    font-size: 0.85rem;
    font-weight: 600;
    color: #1b2a4a;
    margin-bottom: 0.4rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}
.file-input {
    display: block;
    width: 100%;
    padding: 0.6rem;
    border: 2px solid #b0b8c9;
    border-radius: 4px;
    background: #f7f8fa;
    font-size: 0.92rem;
    cursor: pointer;
    transition: border-color 0.15s;
    box-sizing: border-box;
}
.file-input:hover {
    border-color: #c5a44e;
}
.file-input:focus {
    outline: none;
    border-color: #1b2a4a;
    box-shadow: 0 0 0 2px rgba(27,42,74,0.15);
}

/* ---------- Options ---------- */
.option-group {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid #e8ebf0;
}
.option-label {
    font-size: 0.9rem;
    color: #3d4f6f;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.option-checkbox {
    accent-color: #1b2a4a;
    width: 1.1em;
    height: 1.1em;
    cursor: pointer;
}

/* ---------- Log area ---------- */
.log-card {
    background: #fafbfc;
}
.log-area {
    max-height: 280px;
    overflow-y: auto;
    padding: 0.5rem 0;
}
.log-entry {
    margin: 0.3rem 0;
    padding: 0.35rem 0.5rem;
    font-size: 0.85rem;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    line-height: 1.5;
    border-radius: 3px;
}
.log-icon {
    display: inline-block;
    width: 1.2em;
    text-align: center;
    margin-right: 0.3em;
}
.log-error {
    color: #9b1c1c;
    background: #fde8e8;
    font-weight: 600;
}
.log-warn {
    color: #8e4b10;
    background: #fef3cd;
}
.log-info {
    color: #1a6b3c;
    background: #e8f5e9;
}

/* ---------- Footer ---------- */
.app-footer {
    text-align: center;
    padding: 1rem;
    font-size: 0.8rem;
    color: #6b7a94;
    border-top: 1px solid #d0d5dd;
    background: #f2f4f7;
}
.app-footer a {
    color: #1b2a4a;
    text-decoration: none;
    font-weight: 500;
}
.app-footer a:hover {
    color: #c5a44e;
    text-decoration: underline;
}
</style>
