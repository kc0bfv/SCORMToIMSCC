<script setup lang="ts">
import { ref } from 'vue';
import './lib/jszip.min.js';
import { generateIMSCCManifest, createSimpleCourseConfig, downloadManifest } from './lib/imscc-generator-vite';

import type { IMSCCResource, IMSCCItem } from './lib/imscc-generator-vite';
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

  const resources = resources_raw.map( (dat: RawResource, index: number) : IMSCCResource => {
    return {
        identifier: `resource_${index}`,
        type: "webcontent",
        files: [ `resource_${index}.html` ]
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
      <p><a href="">Source Code</a></p>
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
