import type { RhinoModule, NurbsCurve } from 'rhino3dm';
import { RhinoCompute } from './rhino3dm';
import { fetchRhinoCompute, zipArgs } from 'rhino-compute-core/core';

export interface TestResult {
  function: string;
  success: boolean;
  [key: string]: any;
}

export async function testCurveExtend(rhino: RhinoModule): Promise<TestResult> {
  const testCurve = rhino.Curve.createControlPointCurve(
    [
      [0, 0, 0],
      [1, 2, 0],
      [3, 3, 0],
      [4, 0, 0],
    ],
    3,
  );

  const args = zipArgs(false, testCurve, 10, 10);
  const url = 'rhino/geometry/curve/extend-curve_double_double';
  const result = await fetchRhinoCompute(url, args, {
    serverUrl: RhinoCompute.url,
  });

  const decoded = rhino.CommonObject.decode(result);

  return {
    function: 'Curve.extend',
    type: decoded,
    inputPoints: 4,
    resultType: decoded.constructor.name,
    success: true,
  };
}

export async function testCurveLength(rhino: RhinoModule): Promise<TestResult> {
  const testCurve = rhino.Curve.createControlPointCurve(
    [
      [0, 0, 0],
      [5, 0, 0],
      [10, 5, 0],
    ],
    2,
  ) as NurbsCurve;

  const length = await RhinoCompute.Curve.getLength(testCurve);

  return {
    function: 'Curve.getLength',
    curveLength: length,
    success: true,
  };
}

export async function testBrepSphere(): Promise<TestResult> {
  const center = { X: 0, Y: 0, Z: 0 };
  const radius = 5;
  const tolerance = 0.01;
  const url = 'rhino/geometry/brep/createbaseballsphere-point3d_double_double';

  const args = zipArgs(false, center, radius, tolerance);

  const sphereRes = await fetchRhinoCompute(url, args, {
    serverUrl: RhinoCompute.url,
  });

  return {
    function: 'Brep.createFromSphere',
    radius: radius,
    resultType: 'Brep',
    result: sphereRes,
    success: true,
  };
}

export const computeTests = [
  {
    id: 'curve-extend',
    name: 'Curve Extend',
    description: 'Extend a control point curve',
    fn: testCurveExtend,
  },
  {
    id: 'curve-length',
    name: 'Curve Length',
    description: 'Calculate curve length',
    fn: testCurveLength,
  },
  {
    id: 'brep-sphere',
    name: 'Brep Sphere',
    description: 'Create a sphere brep',
    fn: testBrepSphere,
  },
] as const;
