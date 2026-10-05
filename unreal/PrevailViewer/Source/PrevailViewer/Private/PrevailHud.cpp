#include "PrevailHud.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "PrevailLiveSubsystem.h"

void APrevailHud::DrawHUD()
{
	Super::DrawHUD();
	if (!Canvas || !GEngine)
	{
		return;
	}

	const UGameInstance* GI = GetGameInstance();
	const UPrevailLiveSubsystem* Live = GI ? GI->GetSubsystem<UPrevailLiveSubsystem>() : nullptr;
	if (!Live)
	{
		return;
	}

	const int32 Kmh = FMath::RoundToInt(Live->Latest.VehicleSpeedMps * 3.6);
	const FString Line1 = FString::Printf(TEXT("PREVAIL ENGINE  %s"), Live->bConnected ? TEXT("LIVE") : TEXT("LINK"));
	const FString Line2 = FString::Printf(TEXT("%d km/h"), Kmh);
	const FString Line3 = FString::Printf(
		TEXT("edge %s   next %s  %.0f%%   holder %s"),
		*Live->Latest.CurrentEdgeId,
		*Live->Latest.PredictedEdgeId,
		Live->Latest.PredictionConfidence * 100.0f,
		*Live->Latest.AuthorityHolder);

	FCanvasTextItem Title(FVector2D(40.0f, 36.0f), FText::FromString(Line1), GEngine->GetLargeFont(), FLinearColor::White);
	Title.Scale = FVector2D(1.4f, 1.4f);
	Canvas->DrawItem(Title);

	FCanvasTextItem Speed(FVector2D(40.0f, 80.0f), FText::FromString(Line2), GEngine->GetLargeFont(), FLinearColor::White);
	Speed.Scale = FVector2D(2.2f, 2.2f);
	Canvas->DrawItem(Speed);

	FCanvasTextItem Meta(FVector2D(40.0f, 150.0f), FText::FromString(Line3), GEngine->GetMediumFont(), FLinearColor(0.8f, 0.85f, 0.9f));
	Canvas->DrawItem(Meta);

	const FString Hint = TEXT("Click window to capture mouse. Drag to orbit. +/- to zoom. Esc releases cursor.");
	FCanvasTextItem Help(FVector2D(40.0f, Canvas->SizeY - 48.0f), FText::FromString(Hint), GEngine->GetSmallFont(), FLinearColor(0.75f, 0.78f, 0.82f));
	Canvas->DrawItem(Help);
}
