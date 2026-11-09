// Grasshopper Script Instance
using System;

using Grasshopper.Kernel;

public class Script_Instance : GH_ScriptInstance
{
    // Stands in for an expensive step at the top of a real definition: everything geometric hangs
    // off Base, so a warm solve of anything below skips this wait and a cold one pays it. Sleep, not
    // a busy loop, so a bench run doesn't load every core.
    private void RunScript(object Seconds, ref object Base)
    {
        double seconds = 0;
        GH_Convert.ToDouble(Seconds, out seconds, GH_Conversion.Both);
        System.Threading.Thread.Sleep((int)Math.Round(Math.Max(0, seconds) * 1000));
        Base = 1.0;
    }
}
