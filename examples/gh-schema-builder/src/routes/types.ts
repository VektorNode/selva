import { Box, Brep, Line, NurbsCurve, Point } from 'rhino3dm';

export type GrasshopperOutput = {
  contextBox: Box;
  line: Line;
  curve: NurbsCurve;
  point: Point;
  contextString: string;
  contextInt: number;
  contextDouble: number;
  contextBool: boolean;
  contextBrep: Brep;
  fIleData: Point;
  contextPrintArray: number[];
  contextPrintTree: Record<string, any>;
};
