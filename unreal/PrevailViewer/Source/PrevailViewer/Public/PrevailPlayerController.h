#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "PrevailPlayerController.generated.h"

UCLASS()
class PREVAILVIEWER_API APrevailPlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	APrevailPlayerController();
	virtual void BeginPlay() override;
	virtual void SetupInputComponent() override;
	virtual void PlayerTick(float DeltaSeconds) override;

private:
	void OnPrimaryClick();
	void OrbitRight(float Value);
	void OrbitUp(float Value);
	void OrbitDown(float Value);
	void ZoomIn();
	void ZoomOut();
	void CaptureView();
	void ReleaseView();

	bool bViewCaptured = false;
	float OrbitYaw = 0.0f;
	float OrbitPitch = -11.0f;
};
