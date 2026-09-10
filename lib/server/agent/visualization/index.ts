/* eslint-disable no-console */
import * as fs from 'node:fs/promises';
import { graph } from '../graph';

export async function GraphVisualization(type: 'mermaid' | 'png' | 'json' = 'mermaid') {
  // Get graph representation (no deprecation)
  const drawableGraph = await graph.getGraphAsync({ xray: true }); // xray expands subgraphs

  switch (type) {
    // 1. Get Mermaid syntax
    case 'mermaid': {
      const mermaidCode = drawableGraph.drawMermaid();
      console.log('======Mermaid Code==========', mermaidCode);
      break;
    }

    // 2. Generate PNG image
    case 'png': {
      const image = await drawableGraph.drawMermaidPng();
      const imageBuffer = new Uint8Array(await image.arrayBuffer());
      await fs.writeFile('agent.png', imageBuffer);
      break;
    }

    // 3. Get JSON representation (for debugging or custom visualization)
    case 'json': {
      const json = drawableGraph.toJSON();
      console.log('======JSON Representation==========', JSON.stringify(json, null, 2));
      break;
    }
    default:
      console.error('Unsupported visualization type. Use "mermaid", "png", or "json".');
  }
}
