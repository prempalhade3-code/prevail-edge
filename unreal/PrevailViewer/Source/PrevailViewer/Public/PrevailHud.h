#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "PrevailHud.generated.h"

UCLASS()
class PREVAILVIEWER_API APrevailHud : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;
};
