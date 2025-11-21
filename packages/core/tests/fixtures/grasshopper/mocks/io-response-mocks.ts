import { IoResponseSchema } from '@/features/grasshopper';
import { InputParamSchema } from '@/grasshopper';

export const mockGrasshopperIoResponse: IoResponseSchema = {
  Description: '',
  FileName: '',
  CacheKey: 'http://localhost:5173/input_test.gh',
  InputNames: ['Flat Input Tree', 'One Branch', 'Complex Branch'],
  OutputNames: ['Example Out 1', 'Example Out 2', 'Example Out 3'],
  Icon: null,
  Inputs: [
    {
      Description: '',
      AtLeast: 1,
      AtMost: 1,
      TreeAccess: false,
      Default: {
        ParamName: 'Get Number',
        InnerTree: {
          '{0}': [
            {
              type: 'System.Double',
              data: '1.0',
            },
            {
              type: 'System.Double',
              data: '2.0',
            },
            {
              type: 'System.Double',
              data: '3.0',
            },
          ],
        },
      },
      Minimum: null,
      Maximum: null,
      GroupName: null,
      Name: 'Flat Input Tree',
      Nickname: null,
      ParamType: 'Number',
    },
    {
      Description: '',
      AtLeast: 1,
      AtMost: 1,
      TreeAccess: true,
      Default: {
        ParamName: 'Get Number',
        InnerTree: {
          '{0}': [
            {
              type: 'System.Double',
              data: '1.0',
            },
            {
              type: 'System.Double',
              data: '2.0',
            },
            {
              type: 'System.Double',
              data: '3.0',
            },
          ],
        },
      },
      Minimum: null,
      Maximum: null,
      GroupName: null,
      Name: 'One Branch',
      Nickname: null,
      ParamType: 'Number',
    },
    {
      Description: '',
      AtLeast: 1,
      AtMost: 1,
      TreeAccess: true,
      Default: {
        ParamName: 'Get Number',
        InnerTree: {
          '{0;0}': [
            {
              type: 'System.Double',
              data: '1.0',
            },
          ],
          '{0;1}': [
            {
              type: 'System.Double',
              data: '2.0',
            },
          ],
          '{0;2}': [
            {
              type: 'System.Double',
              data: '3.0',
            },
          ],
          '{1;0}': [
            {
              type: 'System.Double',
              data: '1.0',
            },
          ],
          '{1;1}': [
            {
              type: 'System.Double',
              data: '2.0',
            },
          ],
          '{1;2}': [
            {
              type: 'System.Double',
              data: '3.0',
            },
          ],
        },
      },
      Minimum: null,
      Maximum: null,
      GroupName: null,
      Name: 'Complex Branch',
      Nickname: null,
      ParamType: 'Number',
    },
  ],
  Outputs: [
    {
      Name: 'Example Out 1',
      Nickname: null,
      ParamType: 'Text',
    },
    {
      Name: 'Example Out 2',
      Nickname: null,
      ParamType: 'Text',
    },
    {
      Name: 'Example Out 3',
      Nickname: null,
      ParamType: 'Text',
    },
  ],
  Warnings: [],
  Errors: [],
}; // as GrasshopperIoResponse (will not worked due no camel casing yet);

export const rawMockNumberInput: InputParamSchema = {
  description: '',
  atLeast: 1,
  atMost: 1,
  treeAccess: false,
  default: {
    paramName: 'Get Number',
    innerTree: {
      '{0}': [
        {
          type: 'System.Double',
          data: '1.0',
        },
        {
          type: 'System.Double',
          data: '2.0',
        },
        {
          type: 'System.Double',
          data: '3.0',
        },
      ],
    },
  },
  minimum: null,
  maximum: null,
  groupName: null,
  name: 'Flat Input Tree',
  nickname: null,
  paramType: 'Number',
} as InputParamSchema;

export const rawMockNumberInputWTreeAccess = {
  description: '',
  atLeast: 1,
  atMost: 1,
  treeAccess: true,
  default: {
    paramName: 'Get Number',
    innerTree: {
      '{0;0}': [
        {
          type: 'System.Double',
          data: '1.0',
        },
      ],
      '{0;1}': [
        {
          type: 'System.Double',
          data: '2.0',
        },
      ],
      '{0;2}': [
        {
          type: 'System.Double',
          data: '3.0',
        },
      ],
      '{1;0}': [
        {
          type: 'System.Double',
          data: '1.0',
        },
      ],
      '{1;1}': [
        {
          type: 'System.Double',
          data: '2.0',
        },
      ],
      '{1;2}': [
        {
          type: 'System.Double',
          data: '3.0',
        },
      ],
    },
  },
  minimum: null,
  maximum: null,
  groupName: null,
  name: 'Complex Branch',
  nickname: null,
  paramType: 'Number',
} as const;

const _INPUT_MOCK_2: IoResponseSchema = {
  Description: '',
  FileName: '',
  CacheKey: 'http://localhost:5173/scripts/duen.gh',
  InputNames: ['line-data', 'Länge 2', 'Winkel 1', 'Dicke', 'Winkel 2'],
  OutputNames: ['AREA'],
  Icon: null,
  Inputs: [
    {
      Description: '',
      AtLeast: 1,
      AtMost: 1,
      TreeAccess: false,
      Default: {
        ParamName: 'Get String',
        InnerTree: {},
      },
      Minimum: null,
      Maximum: null,
      GroupName: 'hidden',
      Name: 'line-data',
      Nickname: null,
      ParamType: 'Text',
    },
    {
      Description: '',
      AtLeast: 1,
      AtMost: 1,
      TreeAccess: false,
      Default: {
        ParamName: 'Get Number',
        InnerTree: {
          '{0}': [
            {
              type: 'System.Double',
              data: '25.0',
            },
          ],
        },
      },
      Minimum: 5,
      Maximum: 30,
      GroupName: 'Inputs',
      Name: 'Länge 2',
      Nickname: null,
      ParamType: 'Number',
    },
    {
      Description: '',
      AtLeast: 1,
      AtMost: 1,
      TreeAccess: false,
      Default: {
        ParamName: 'Get Number',
        InnerTree: {
          '{0}': [
            {
              type: 'System.Double',
              data: '30.0',
            },
          ],
        },
      },
      Minimum: 20,
      Maximum: 30,
      GroupName: 'Inputs',
      Name: 'Winkel 1',
      Nickname: null,
      ParamType: 'Number',
    },
    {
      Description: '',
      AtLeast: 1,
      AtMost: 1,
      TreeAccess: false,
      Default: {
        ParamName: 'Get Number',
        InnerTree: {
          '{0}': [
            {
              type: 'System.Double',
              data: '0.5',
            },
          ],
        },
      },
      Minimum: 0.5,
      Maximum: 1,
      GroupName: 'Inputs',
      Name: 'Dicke',
      Nickname: null,
      ParamType: 'Number',
    },
    {
      Description: '',
      AtLeast: 1,
      AtMost: 1,
      TreeAccess: false,
      Default: {
        ParamName: 'Get Number',
        InnerTree: {
          '{0}': [
            {
              type: 'System.Double',
              data: '32.0',
            },
          ],
        },
      },
      Minimum: 10,
      Maximum: 80,
      GroupName: 'Inputs',
      Name: 'Winkel 2',
      Nickname: null,
      ParamType: 'Number',
    },
  ],
  Outputs: [
    {
      Name: 'AREA',
      Nickname: null,
      ParamType: 'Text',
    },
  ],
  Warnings: [],
  Errors: ['GH - Missing Definition Objects'],
} as const;
