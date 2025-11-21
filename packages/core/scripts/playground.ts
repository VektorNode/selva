import { RhinoModule } from 'rhino3dm';

import { GrasshopperResponseProcessor } from '../src/features/grasshopper';

import { data } from './output-response';

async function handleFetchIo() {
  try {
    const resultProcessor = new GrasshopperResponseProcessor(data);
    const { values, types } = resultProcessor.getValues({ generateTypes: true });

    const rhino3dm = await import('rhino3dm');
    const module: RhinoModule = await rhino3dm.default();

    const res = resultProcessor.getValues({ rhino: module });

    // console.log('Extracted Values:', types);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run it
handleFetchIo();
