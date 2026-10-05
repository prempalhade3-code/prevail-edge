#include "PrevailPlayerController.h"
#include "PrevailVehiclePawn.h"
#include "GameFramework/SpringArmComponent.h"

APrevailPlayerController::APrevailPlayerController()
{
	bShowMouseCursor = true;
	bEnableClickEvents = true;
	bEnableMouseOverEvents = true;
}

void APrevailPlayerController::BeginPlay()
{
	Super::BeginPlay();
	SetIgnoreLookInput(false);
	SetIgnoreMoveInput(false);
}

void APrevailPlayerController::SetupInputComponent()
{
	Super::SetupInputComponent();
	if (!InputComponent)
	{
		return;
	}

	InputComponent->BindAction(TEXT("CaptureView"), IE_Pressed, this, &APrevailPlayerController::CaptureView);
	InputComponent->BindAction(TEXT("PrimaryClick"), IE_Pressed, this, &APrevailPlayerController::OnPrimaryClick);
	InputComponent->BindAction(TEXT("ZoomIn"), IE_Pressed, this, &APrevailPlayerController::ZoomIn);
	InputComponent->BindAction(TEXT("ZoomOut"), IE_Pressed, this, &APrevailPlayerController::ZoomOut);
	InputComponent->BindAxis(TEXT("OrbitYaw"), this, &APrevailPlayerController::OrbitRight);
	InputComponent->BindAxis(TEXT("OrbitPitch"), this, &APrevailPlayerController::OrbitUp);
	InputComponent->BindKey(EKeys::Escape, IE_Pressed, this, &APrevailPlayerController::ReleaseView);
}

void APrevailPlayerController::PlayerTick(float DeltaSeconds)
{
	Super::PlayerTick(DeltaSeconds);
	if (!bViewCaptured)
	{
		return;
	}

	APrevailVehiclePawn* Car = Cast<APrevailVehiclePawn>(GetPawn());
	if (!Car || !Car->SpringArm)
	{
		return;
	}
	Car->SpringArm->SetRelativeRotation(FRotator(OrbitPitch, OrbitYaw, 0.0f));
}

void APrevailPlayerController::CaptureView()
{
	bViewCaptured = true;
	bShowMouseCursor = false;
	FInputModeGameOnly Mode;
	SetInputMode(Mode);
	SetIgnoreLookInput(false);
}

void APrevailPlayerController::ReleaseView()
{
	bViewCaptured = false;
	bShowMouseCursor = true;
	FInputModeGameAndUI Mode;
	SetInputMode(Mode);
}

void APrevailPlayerController::OnPrimaryClick()
{
	if (!bViewCaptured)
	{
		CaptureView();
	}
}

void APrevailPlayerController::OrbitRight(float Value)
{
	if (bViewCaptured && !FMath::IsNearlyZero(Value))
	{
		OrbitYaw += Value;
	}
}

void APrevailPlayerController::OrbitUp(float Value)
{
	if (bViewCaptured && !FMath::IsNearlyZero(Value))
	{
		OrbitPitch = FMath::Clamp(OrbitPitch + Value, -35.0f, 5.0f);
	}
}

void APrevailPlayerController::OrbitDown(float Value)
{
	OrbitUp(-Value);
}

void APrevailPlayerController::ZoomIn()
{
	if (APrevailVehiclePawn* Car = Cast<APrevailVehiclePawn>(GetPawn()))
	{
		if (Car->SpringArm)
		{
			Car->SpringArm->TargetArmLength = FMath::Max(420.0f, Car->SpringArm->TargetArmLength - 80.0f);
		}
	}
}

void APrevailPlayerController::ZoomOut()
{
	if (APrevailVehiclePawn* Car = Cast<APrevailVehiclePawn>(GetPawn()))
	{
		if (Car->SpringArm)
		{
			Car->SpringArm->TargetArmLength = FMath::Min(1800.0f, Car->SpringArm->TargetArmLength + 80.0f);
		}
	}
}
