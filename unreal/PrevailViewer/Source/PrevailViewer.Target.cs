using UnrealBuildTool;

public class PrevailViewerTarget : TargetRules
{
	public PrevailViewerTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("PrevailViewer");
	}
}
