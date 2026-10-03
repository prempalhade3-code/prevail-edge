using UnrealBuildTool;

public class PrevailViewerEditorTarget : TargetRules
{
	public PrevailViewerEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("PrevailViewer");
	}
}
