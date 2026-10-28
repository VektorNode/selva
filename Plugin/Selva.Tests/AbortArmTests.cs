using Selva.GH.Features.SolveRuntime.Services;

namespace Selva.Tests;

public class AbortArmTests
{
    private long _now;

    private AbortArm NewArm() => new AbortArm(() => _now);

    [Fact]
    public void Unarmed_ConsumesNothing()
    {
        Assert.False(NewArm().Consume());
    }

    [Fact]
    public void Armed_ConsumesOnce()
    {
        var arm = NewArm();
        arm.Arm();

        Assert.True(arm.Consume());
        Assert.False(arm.Consume());
    }

    [Fact]
    public void Arm_ExpiresAfterTheWindow()
    {
        var arm = NewArm();
        arm.Arm();
        _now += AbortArm.WindowMs;

        Assert.False(arm.Consume());
    }

    [Fact]
    public void Cleared_ConsumesNothing()
    {
        var arm = NewArm();
        arm.Arm();
        arm.Clear();

        Assert.False(arm.Consume());
    }

    [Fact]
    public void ArmAtClockZero_IsStillArmed()
    {
        var arm = NewArm();
        arm.Arm();

        Assert.True(arm.Consume());
    }
}
