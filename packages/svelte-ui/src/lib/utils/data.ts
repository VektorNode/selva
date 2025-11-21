import type { InputParam } from "rhino-compute-core";

// export const exampleInputs: InputParam[] = [
//   {
//     name: 'Width',
//     paramType: 'Number',
//     description: 'Width of the element',
//     default: 10,
//     minimum: 0,
//     maximum: 100,
//     groupName: 'Dimensions'
//   },
//   {
//     name: 'Height',
//     paramType: 'Number',
//     description: 'Height of the element',
//     default: 20,
//     minimum: 0,
//     maximum: 100,
//     groupName: 'Dimensions'
//   },
//   {
//     name: 'Name',
//     paramType: 'Text',
//     description: 'Element name',
//     default: 'MyElement',
//     groupName: 'Properties'
//   },
//   {
//     name: 'Visible',
//     paramType: 'Boolean',
//     description: 'Show or hide element',
//     default: true,
//     groupName: 'Properties'
//   }
// ];


export const example2: InputParam[] = [
  {
    "description": "",
    "name": "data_url",
    "nickname": null,
    "treeAccess": false,
    "groupName": "hidden",
    "paramType": "Text",
    "default": "sdkfjsf"
  },
  {
    "description": "1: Custom, 2: Normalstahl (St37-2), 3: Hardox, 4: Edelstahl, 5: Edelstahl (1.4541), 6: Edelstahl (1.4571) Aluminium (AlMg³)",
    "name": "Material",
    "nickname": null,
    "treeAccess": false,
    "groupName": "",
    "paramType": "Integer",
    "minimum": 1,
    "maximum": 6,
    "atLeast": 1,
    "atMost": 1,
    "stepSize": 1,
    "default": 1
  },
  {
    "description": "",
    "name": "Run OpenNest",
    "nickname": null,
    "treeAccess": false,
    "groupName": "",
    "paramType": "Boolean",
    "default": true
  },
  {
    "description": "",
    "name": "Download Data",
    "nickname": null,
    "treeAccess": false,
    "groupName": "",
    "paramType": "Boolean",
    "default": false
  }
]
