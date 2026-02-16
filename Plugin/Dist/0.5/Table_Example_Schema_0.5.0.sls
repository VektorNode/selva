{
  "metadata": {
    "exportedAt": "2026-02-16T14:53:41.182Z",
    "exportVersion": "1.0.0"
  },
  "schema": {
    "id": "e6d1d578-3081-42ad-bb74-b2f91c2c16b0",
    "name": "This Schema",
    "description": "This is a test",
    "projectFileName": "table_example.gh",
    "documentId": "97bcb4a8-d4aa-4f45-9e4b-4efc241822ab",
    "pluginVersion": "0.5.0.0",
    "tags": [],
    "author": null,
    "organization": null,
    "schemaVersion": "2.0.0",
    "minPluginVersion": null,
    "created": "2026-02-16T09:49:59.0836754Z",
    "lastModified": "2026-02-16T14:49:08.18417Z",
    "viewerOptions": {
      "enableLocal": true,
      "enableRemote": false,
      "backgroundColor": "#adadad"
    },
    "instanceSolve": true,
    "inputs": [
      {
        "id": "61774fb4-e2f5-4d9e-88ee-3ea99e738ffb",
        "nickname": "Table Width",
        "paramType": "integer",
        "description": ""
      },
      {
        "id": "22dff77d-70d3-489e-85d0-122b36b9d9d5",
        "nickname": "Table Length",
        "paramType": "integer",
        "description": ""
      },
      {
        "id": "49667382-3f72-43ff-8338-62cb75e0f99b",
        "nickname": "Table Thickness",
        "paramType": "number",
        "description": ""
      },
      {
        "id": "3beabb17-c1de-4f69-a2a9-5fd80712bd22",
        "nickname": "Corner Radius",
        "paramType": "number",
        "description": ""
      },
      {
        "id": "e0ade68c-3dee-4398-b944-5973e6502082",
        "nickname": "Leg Inset",
        "paramType": "integer",
        "description": ""
      },
      {
        "id": "1ba561ea-06fa-4152-b451-19b2cd91e794",
        "nickname": "Table Height",
        "paramType": "integer",
        "description": ""
      },
      {
        "id": "d5b2d1a5-3438-49ad-bbdd-5a1dabf0084f",
        "nickname": "Leg Width",
        "paramType": "number",
        "description": ""
      },
      {
        "id": "11c40196-4670-48c1-ad19-ca7775f51608",
        "nickname": "Leg Type",
        "paramType": "valueList",
        "description": ""
      },
      {
        "id": "93f1f5fc-ab01-4f35-8a0a-2bad8b663e81",
        "nickname": "File Name",
        "paramType": "text",
        "description": ""
      },
      {
        "id": "c30f796c-c382-46e5-b092-b6862119d190",
        "nickname": "Leg Radius",
        "paramType": "number",
        "description": ""
      },
      {
        "id": "842b72cc-ea89-494d-9512-24f1f41d1156",
        "nickname": "Create Legs",
        "paramType": "boolean",
        "description": ""
      }
    ],
    "outputs": [
      {
        "id": "4a9bd7bd-a4d2-4af4-a5ff-0c5644ad7feb",
        "nickname": "Pipi Changed ",
        "description": "",
        "type": "text"
      }
    ],
    "layout": {
      "type": "tabbed",
      "tabs": [
        {
          "id": "6360a716",
          "label": "Tab 1",
          "icon": "",
          "order": 0,
          "groups": [
            {
              "id": "74f942be",
              "label": "Group 1",
              "description": "",
              "order": 0,
              "collapsed": false,
              "columns": 1,
              "items": [
                {
                  "type": "input",
                  "widgetType": "number",
                  "config": {
                    "minimum": 100,
                    "maximum": 250,
                    "stepSize": 1,
                    "placeholder": null,
                    "renderAsSlider": true
                  },
                  "id": "6783255b",
                  "paramId": "61774fb4-e2f5-4d9e-88ee-3ea99e738ffb",
                  "displayName": "Table Width",
                  "description": "This is the table width",
                  "order": 0,
                  "span": 1,
                  "visible": true,
                  "visibilityCondition": null
                },
                {
                  "type": "input",
                  "widgetType": "number",
                  "config": {
                    "minimum": 100,
                    "maximum": 500,
                    "stepSize": 1,
                    "placeholder": null,
                    "renderAsSlider": true
                  },
                  "id": "a976baf8",
                  "paramId": "22dff77d-70d3-489e-85d0-122b36b9d9d5",
                  "displayName": "Table Length",
                  "description": "",
                  "order": 1,
                  "span": 1,
                  "visible": true,
                  "visibilityCondition": null
                },
                {
                  "type": "input",
                  "widgetType": "number",
                  "config": {
                    "minimum": 1,
                    "maximum": 6,
                    "stepSize": 0.1,
                    "placeholder": null,
                    "renderAsSlider": true
                  },
                  "id": "8b2a8404",
                  "paramId": "49667382-3f72-43ff-8338-62cb75e0f99b",
                  "displayName": "Table Thickness",
                  "description": "",
                  "order": 2,
                  "span": 1,
                  "visible": true,
                  "visibilityCondition": null
                },
                {
                  "type": "input",
                  "widgetType": "number",
                  "config": {
                    "minimum": 0,
                    "maximum": 40,
                    "stepSize": 1,
                    "placeholder": null,
                    "renderAsSlider": true
                  },
                  "id": "5d8f1e0e",
                  "paramId": "3beabb17-c1de-4f69-a2a9-5fd80712bd22",
                  "displayName": "Corner Radius",
                  "description": "",
                  "order": 3,
                  "span": 1,
                  "visible": true,
                  "visibilityCondition": null
                },
                {
                  "type": "input",
                  "widgetType": "number",
                  "config": {
                    "minimum": 0,
                    "maximum": 20,
                    "stepSize": 1,
                    "placeholder": null,
                    "renderAsSlider": true
                  },
                  "id": "76f51be7",
                  "paramId": "e0ade68c-3dee-4398-b944-5973e6502082",
                  "displayName": "Leg Inset",
                  "description": "",
                  "order": 4,
                  "span": 1,
                  "visible": true,
                  "visibilityCondition": null
                },
                {
                  "type": "input",
                  "widgetType": "number",
                  "config": {
                    "minimum": 90,
                    "maximum": 135,
                    "stepSize": 1,
                    "placeholder": null,
                    "renderAsSlider": true
                  },
                  "id": "6cfd8938",
                  "paramId": "1ba561ea-06fa-4152-b451-19b2cd91e794",
                  "displayName": "Table Height",
                  "description": "",
                  "order": 5,
                  "span": 1,
                  "visible": true,
                  "visibilityCondition": null
                }
              ]
            },
            {
              "id": "1e24a601",
              "label": "Group 2",
              "description": "",
              "order": 1,
              "collapsed": false,
              "columns": 1,
              "items": [
                {
                  "type": "input",
                  "widgetType": "number",
                  "config": {
                    "minimum": 1.5,
                    "maximum": 3,
                    "stepSize": 0.1,
                    "placeholder": null,
                    "renderAsSlider": true
                  },
                  "id": "512816b6",
                  "paramId": "d5b2d1a5-3438-49ad-bbdd-5a1dabf0084f",
                  "displayName": "Leg Width",
                  "description": "",
                  "order": 0,
                  "span": 1,
                  "visible": true,
                  "visibilityCondition": null
                },
                {
                  "type": "input",
                  "widgetType": "dropdown",
                  "config": {
                    "options": {
                      "Square": "0",
                      "Cylindrical": "1",
                      "NotDefined": "2"
                    },
                    "required": null
                  },
                  "id": "7de89566",
                  "paramId": "11c40196-4670-48c1-ad19-ca7775f51608",
                  "displayName": "Leg Type",
                  "description": "",
                  "order": 1,
                  "span": 1,
                  "visible": true,
                  "visibilityCondition": null
                },
                {
                  "type": "input",
                  "widgetType": "text",
                  "config": {
                    "placeholder": "Enter File Name",
                    "required": null,
                    "maxLength": null,
                    "pattern": null,
                    "customErrorMessage": null
                  },
                  "id": "b1985f6b",
                  "paramId": "93f1f5fc-ab01-4f35-8a0a-2bad8b663e81",
                  "displayName": "File Name",
                  "description": "",
                  "order": 2,
                  "span": 1,
                  "visible": true,
                  "visibilityCondition": null
                },
                {
                  "type": "input",
                  "widgetType": "number",
                  "config": {
                    "minimum": 1.5,
                    "maximum": 3,
                    "stepSize": 0.1,
                    "placeholder": null,
                    "renderAsSlider": true
                  },
                  "id": "66726a6c",
                  "paramId": "c30f796c-c382-46e5-b092-b6862119d190",
                  "displayName": "Leg Radius",
                  "description": "",
                  "order": 3,
                  "span": 1,
                  "visible": true,
                  "visibilityCondition": null
                },
                {
                  "type": "input",
                  "widgetType": "checkbox",
                  "config": {},
                  "id": "243ee89e",
                  "paramId": "842b72cc-ea89-494d-9512-24f1f41d1156",
                  "displayName": "Create Legs",
                  "description": "",
                  "order": 4,
                  "span": 1,
                  "visible": true,
                  "visibilityCondition": null
                }
              ]
            },
            {
              "id": "a6621766",
              "label": "Output",
              "description": "",
              "order": 2,
              "collapsed": false,
              "columns": 1,
              "items": [
                {
                  "type": "output",
                  "widgetType": "text",
                  "id": "f9d83c97",
                  "paramId": "4a9bd7bd-a4d2-4af4-a5ff-0c5644ad7feb",
                  "displayName": "Pipi Changed ",
                  "description": "",
                  "order": 0,
                  "span": 1,
                  "visible": true,
                  "visibilityCondition": null
                }
              ]
            }
          ],
          "position": "center"
        }
      ],
      "gap": 16
    }
  }
}