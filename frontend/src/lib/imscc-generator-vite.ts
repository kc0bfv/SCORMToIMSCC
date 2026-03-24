/**
 * IMSCC Manifest Generator for Vite/Browser
 * 
 * Complete implementation for generating IMSCC (Common Cartridge) manifests
 * Modified for browser compatibility
 */

// ============================================================================
// INTERFACE DEFINITIONS
// ============================================================================

export interface IMSCCResource {
  identifier: string;
  type: string;
  files: string[];
  dependencies?: string[];
}

export interface IMSCCItem {
  identifier: string;
  identifierref?: string;
  title: string;
  items?: IMSCCItem[];
}

export interface IMSCCManifestConfig {
  identifier: string;
  title: string;
  description?: string;
  schemaVersion: string;
  organization: {
    identifier: string;
    structure: string;
    items: IMSCCItem[];
  };
  resources: IMSCCResource[];
  metadata?: {
    language?: string;
    keywords?: string[];
    copyright?: string;
    license?: string;
  };
}

// ============================================================================
// GENERATOR FUNCTIONS
// ============================================================================

/**
 * Creates a complete IMSCC manifest from a configuration object
 */
export function generateIMSCCManifest(config: IMSCCManifestConfig): string {
  const today = new Date().toISOString().split('T')[0];
  
  // Build metadata section
  const metadataXml = `
    <metadata>
      <schema>IMS Common Cartridge</schema>
      <schemaversion>${config.schemaVersion}</schemaversion>
      <lomimscc:lom>
        <lomimscc:general>
          <lomimscc:title>
            <lomimscc:string>${escapeXml(config.title)}</lomimscc:string>
          </lomimscc:title>
          ${config.description ? `
          <lomimscc:description>
            <lomimscc:string>${escapeXml(config.description)}</lomimscc:string>
          </lomimscc:description>` : ''}
        </lomimscc:general>
        <lomimscc:lifeCycle>
          <lomimscc:contribute>
            <lomimscc:date>
              <lomimscc:dateTime>${today}</lomimscc:dateTime>
            </lomimscc:date>
          </lomimscc:contribute>
        </lomimscc:lifeCycle>
        <lomimscc:rights>
          <lomimscc:copyrightAndOtherRestrictions>
            <lomimscc:value>${config.metadata?.copyright ? 'yes' : 'no'}</lomimscc:value>
          </lomimscc:copyrightAndOtherRestrictions>
          <lomimscc:description>
            <lomimscc:string>${config.metadata?.license || 'Public Domain'}</lomimscc:string>
          </lomimscc:description>
        </lomimscc:rights>
      </lomimscc:lom>
    </metadata>`;

  // Build organization section
  const organizationXml = `
    <organizations>
      <organization identifier="${config.organization.identifier}" structure="${config.organization.structure}">
        <item identifier="LearningModules">
          ${generateItemsXml(config.organization.items, 2)}
        </item>
      </organization>
    </organizations>`;

  // Build resources section
  const resourcesXml = `
    <resources>
      ${config.resources.map(resource => generateResourceXml(resource)).join('\n      ')}
    </resources>`;

  // Assemble complete manifest
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${config.identifier}" 
  xmlns="http://www.imsglobal.org/xsd/imsccv1p3/imscp_v1p1" 
  xmlns:lom="http://ltsc.ieee.org/xsd/imsccv1p3/LOM/resource" 
  xmlns:lomimscc="http://ltsc.ieee.org/xsd/imsccv1p3/LOM/manifest" 
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsccv1p3/imscp_v1p1 http://www.imsglobal.org/profile/cc/ccv1p3/ccv1p3_imscp_v1p2_v1p0.xsd">
  ${metadataXml}
  ${organizationXml}
  ${resourcesXml}
</manifest>`;
}

/**
 * Recursively generates XML for items and sub-items
 */
function generateItemsXml(items: IMSCCItem[], indentLevel: number): string {
  const indent = '  '.repeat(indentLevel);
  return items.map(item => {
    const hasChildren = item.items && item.items.length > 0;
    const itemXml = `${indent}<item identifier="${item.identifier}"${item.identifierref ? ` identifierref="${item.identifierref}"` : ''}>
${indent}  <title>${escapeXml(item.title)}</title>
${hasChildren ? generateItemsXml(item.items!, indentLevel + 1) : ''}
${indent}</item>`;
    return itemXml;
  }).join('\n');
}

/**
 * Generates XML for a single resource
 */
function generateResourceXml(resource: IMSCCResource): string {
  const filesXml = resource.files.map(file => `\n      <file href="${escapeXml(file)}"/>`).join('');
  const dependenciesXml = resource.dependencies?.map(dep => `\n      <dependency identifierref="${dep}"/>`).join('') || '';
  
  return `\n    <resource identifier="${resource.identifier}" type="${resource.type}">${filesXml}${dependenciesXml}
    </resource>`;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function generateIdentifier(prefix: string = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// BROWSER UTILITIES
// ============================================================================

/**
 * Downloads an IMSCC manifest file to the user's computer
 */
export function downloadManifest(manifestXml: string, filename: string = 'imsmanifest.xml'): void {
  // Create a Blob with the XML content
  const blob = new Blob([manifestXml], { type: 'application/xml' });
  
  // Create a download link
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  
  // Trigger download
  document.body.appendChild(a);
  a.click();
  
  // Cleanup
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Formats XML with proper indentation for display
 */
export function formatXml(xml: string): string {
  let formatted = '';
  let indent = '';
  const regex = /(>)(<)(\/*)/g;
  
  // Add line breaks between tags
  xml = xml.replace(regex, '$1\n$2$3');
  
  const lines = xml.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line_r = lines[i];
    if (!line_r) continue;

    const line = line_r.trim();
    
    if (!line) continue; // Skip empty lines
    
    if (line.match(/<.*\/>/)) {
      // Single tag (self-closing)
      formatted += indent + line + '\n';
    } else if (line.match(/<\/.*>/)) {
      // Closing tag
      indent = indent.substring(2);
      formatted += indent + line + '\n';
    } else if (line.match(/<.*>/)) {
      // Opening tag
      formatted += indent + line + '\n';
      indent += '  ';
    } else {
      // Text content
      formatted += indent + line + '\n';
    }
  }
  
  return formatted.trim();
}

/**
 * Generates and downloads a manifest in one step
 */
export function generateAndDownloadManifest(
  config: IMSCCManifestConfig, 
  filename?: string
): void {
  const manifest = generateIMSCCManifest(config);
  downloadManifest(
    manifest, 
    filename || `${config.title.replace(/\s+/g, '-').toLowerCase()}-manifest.xml`
  );
}

// ============================================================================
// PRESET CONFIGURATIONS
// ============================================================================

/**
 * Creates a simple course configuration
 */
export function createSimpleCourseConfig(
  title: string,
  description?: string,
  author?: string,
  module?: string,
  items?: IMSCCItem[],
  resources?: IMSCCResource[],
): IMSCCManifestConfig {
  return {
    identifier: generateIdentifier('course'),
    title,
    description,
    schemaVersion: '1.3.0',
    organization: {
      identifier: 'org_simple',
      structure: 'rooted-hierarchy',
      items: [
        {
          identifier: 'module1',
          title: module ? module : 'Module 1',
          items: items ? items : [
            { identifier: 'welcome', identifierref: 'res_welcome', title: 'Welcome' },
            { identifier: 'syllabus', identifierref: 'res_syllabus', title: 'Syllabus' }
          ]
        }
      ]
    },
    resources: resources ? resources : [
      {
        identifier: 'res_welcome',
        type: 'webcontent',
        files: ['welcome.html']
      },
      {
        identifier: 'res_syllabus',
        type: 'webcontent',
        files: ['syllabus.html']
      }
    ],
    metadata: {
      license: author ? `Created by ${author}` : 'Public Domain'
    }
  };
}

/**
 * Creates a multimedia course configuration
 */
export function createMultimediaCourseConfig(
  title: string
): IMSCCManifestConfig {
  return {
    identifier: generateIdentifier('media'),
    title,
    schemaVersion: '1.3.0',
    organization: {
      identifier: 'org_media',
      structure: 'rooted-hierarchy',
      items: [
        {
          identifier: 'module1',
          title: 'Module 1: Content',
          items: [
            { identifier: 'video', identifierref: 'res_video', title: 'Video Lecture' },
            { identifier: 'quiz', identifierref: 'res_quiz', title: 'Knowledge Check' }
          ]
        }
      ]
    },
    resources: [
      {
        identifier: 'res_video',
        type: 'webcontent',
        files: ['lectures/video.mp4', 'lectures/transcript.txt']
      },
      {
        identifier: 'res_quiz',
        type: 'imsqti_xmlv1p2/imscc_xmlv1p3/assessment',
        files: ['assessments/quiz.xml']
      }
    ]
  };
}

// ============================================================================
// REACT/VUE HOOKS (OPTIONAL)
// ============================================================================

/**
 * React hook for IMSCC manifest generation
 * Example usage in a React component:
 * 
 * function IMSCCGenerator() {
 *   const { generateManifest, downloadManifest, manifest } = useIMSCCGenerator();
 *   
 *   const handleGenerate = () => {
 *     const config = createSimpleCourseConfig('My Course', 'Description', 'Author');
 *     generateManifest(config);
 *   };
 *   
 *   return (
 *     <div>
 *       <button onClick={handleGenerate}>Generate</button>
 *       {manifest && (
 *         <button onClick={() => downloadManifest(manifest)}>Download</button>
 *       )}
 *     </div>
 *   );
 * }
 */
export function useIMSCCGenerator() {
  // This is a conceptual hook - implement according to your framework
  return {
    generateManifest: (config: IMSCCManifestConfig) => generateIMSCCManifest(config),
    downloadManifest,
    formatXml
  };
}

/**
 * USAGE EXAMPLES:
 * 
 * // 1. Simple generation
 * const config = createSimpleCourseConfig('My Course', 'Description', 'Author');
 * const manifest = generateIMSCCManifest(config);
 * 
 * // 2. Download immediately
 * generateAndDownloadManifest(config);
 * 
 * // 3. Custom configuration
 * const customConfig: IMSCCManifestConfig = {
 *   identifier: generateIdentifier(),
 *   title: 'Custom Course',
 *   schemaVersion: '1.3.0',
 *   organization: { ... },
 *   resources: [ ... ]
 * };
 * 
 * // 4. In a React component
 * function CourseGenerator() {
 *   const handleGenerate = () => {
 *     const config = createSimpleCourseConfig('React Course');
 *     generateAndDownloadManifest(config);
 *   };
 *   
 *   return <button onClick={handleGenerate}>Generate Course</button>;
 * }
 * 
 * The generated XML conforms to IMSCC 1.3.0 standard and can be imported into:
 * - Canvas
 * - Moodle  
 * - Blackboard
 * - Other IMSCC-compatible LMS platforms
 */
