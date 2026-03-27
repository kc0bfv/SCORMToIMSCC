<script setup lang="ts">
import { ref } from 'vue';
import './lib/jszip.min.js';
import { generateIMSCCManifest, createSimpleCourseConfig, downloadManifest } from './lib/imscc-generator-vite';

import type { IMSCCResource, IMSCCItem } from './lib/imscc-generator-vite';

interface SCORMAsset {
    id: number;
    url: string;
    width?: number;
    height?: number;
    imageType?: string;
}

interface SlideImageFile {
    assetId: number;
    filename: string;
    data: Uint8Array;
}
type JSONTree = any;
declare const JSZip : any;
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

const IMAGE_EXTENSION_REGEX = /(\.png|\.jpg|\.jpeg|\.gif|\.svg)$/i;

function isValidImageAsset(asset: SCORMAsset | undefined): asset is SCORMAsset {
    if ( !asset || typeof asset.url !== "string" ) { return false; }
    const normalized_url = asset.url.toLowerCase();
    if ( !IMAGE_EXTENSION_REGEX.test(normalized_url) ) { return false; }
    const base_name = normalized_url.split("/").pop() ?? "";
    if ( base_name.startsWith("shape") ) { return false; }
    const width = typeof asset.width === "number" ? asset.width : Number(asset.width);
    const height = typeof asset.height === "number" ? asset.height : Number(asset.height);
    if ( Number.isFinite(width) && width <= 100 ) { return false; }
    if ( Number.isFinite(height) && height <= 100 ) { return false; }
    return true;
}

function getSafeFilename(asset: SCORMAsset): string {
    const base_name_raw = asset.url?.split("/").pop() ?? `asset_${asset.id}`;
    if ( base_name_raw.toLowerCase().startsWith("asset_")) {
        return `${asset.id}_${base_name_raw}`;
    }
    return `${asset.id}_${base_name_raw}`;
}

function appendImagesToContent(content: string, imagePaths: string[]): string {
    if ( !imagePaths.length ) { return content; }
    const images_html = imagePaths.map((path) => `<img src="${path}" alt="Slide image" />`).join("\n");
    return `${content}\n<div class="slide-images">\n${images_html}\n</div>`;
}

function normalizeSlideRefId(refId: string | undefined, known_slides: Record<string, KnownSlide>): string | undefined {
    if ( !refId ) { return undefined; }
    if ( refId in known_slides ) { return refId; }
    const parts = refId.split(".");
    const last_part = parts.length ? parts[parts.length - 1] : refId;
    if ( last_part && last_part in known_slides ) { return last_part; }
    return last_part || refId;
}

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

function extractAssetCandidates(assetLib: JSONTree): SCORMAsset[] {
    if ( Array.isArray(assetLib) ) { return assetLib; }
    if ( assetLib && Array.isArray(assetLib.assets) ) { return assetLib.assets; }
    if ( assetLib && Array.isArray(assetLib.records) ) { return assetLib.records; }
    return [];
}

const one_file_error = ref(false);

function getModuleData(meta_xml: string) : [ string, string ] {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(meta_xml, "text/xml");
    const errorNode = xmlDoc.querySelector("parsererror");
    if (errorNode) {
        console.error("Error parsing XML:", errorNode.textContent);
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
        console.error(`Error in recursive_GKS, continuing: ${error}`);
    }
    return known_slides;
}

function getKnownSlides(frame_data: JSONTree) : Record<string, KnownSlide> | undefined {
  var known_slides : Record<string, KnownSlide> = {};

  if ( !( frame_data && frame_data.navData
    && frame_data.navData.outline && frame_data.navData.outline.links
    && Array.isArray(frame_data.navData.outline.links) ) )
  {
    console.error("Invalid frame_data");
    return;
  }

  for ( const link of frame_data.navData.outline.links ) {
    known_slides = recursive_GKS(link, known_slides);
  }

  return known_slides;
}

async function handleFileChange(event: Event) {
  if ( ! event.target ) { console.error("Invalid event target."); return; }

  const files = (event.target as HTMLInputElement).files;
  if ( ! files ) { console.error("Invalid event target files."); return; }

  if ( files.length != 1 ) { one_file_error.value = true; return; }
  else { one_file_error.value = false; }

  const zip_input = await JSZip.loadAsync(files[0]);
  
  const meta_xml = await zip_input.file("meta.xml").async("string");
  const module_data = getModuleData(meta_xml);
  if ( ! module_data ) {
    console.error("Failure to retrieve module data.");
    return;
  }

  const module_name = module_data[0];
  const author = module_data[1];

  const frame_file_content = await zip_input.file("html5/data/js/frame.js").async("string");

  // This is a ridiculous, insecure implementation of what I'm doing, but *shrug*
  window.globalProvideData = (nm: string, dat: string) : undefined => {
    window.globalProvideData[nm] = dat;
  };
  eval(frame_file_content);

  const frame_data = JSON.parse(window.globalProvideData["frame"]);

  const known_slides = getKnownSlides(frame_data);
  if ( ! known_slides ) {
    console.error("Failure to retrieve known slides.");
    return;
  }

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
        console.warn("SCORM data payload missing after evaluating data.js");
      }
    } else {
      console.warn("Could not locate html5/data/js/data.js within the SCORM package.");
    }
  } catch (error) {
    console.error("Error parsing SCORM data from data.js", error);
  }

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

  const included_slide_ids = new Set(resources_raw.map((resource: RawResource) => resource.slideId));
  const assetBinaryCache = new Map<number, SlideImageFile>();
  const resourceImagePaths: Record<number, string[]> = {};

  if ( scorm_data ) {
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

    const slideImageFilesMap: Record<string, SlideImageFile[]> = {};

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
          console.error(`Failed to read asset at ${path}`, file_error);
        }
      }
      console.warn(`Unable to locate asset content for url ${asset.url}`);
      return undefined;
    };

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

  const zip = new window.JSZip();
  zip.file("imsmanifest.xml", manifest);

  resources_raw.forEach( (dat: RawResource, index: number) => {
    zip.file(`resource_${index}.html`, dat.content);
  });

  assetBinaryCache.forEach((image) => {
    zip.file(`images/${image.filename}`, image.data);
  });

  const blob = await zip.generateAsync({type:"blob"})
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
  <h1>Articulate Storyline SCORM to IMSCC Converter</h1>
  <div>
      <p><a href="https://github.com/kc0bfv/SCORMToIMSCC">Source Code</a></p>
      <p>All content remains within your browser - all conversion happens in your browser's JavaScript.</p>
  </div>
  <div>
      <label for="infile">Select SCORM zip file.</label>
      <input
        id="infile"
        type="file"
        accept=".zip"
        @change="(event) => { void handleFileChange(event); }"
      >
      <p
        id="#onefile"
        class="error"
        :class="{ 'invisible': !one_file_error }"
      >
        Select only one file.
      </p>
  </div>
</template>

<style scoped></style>
