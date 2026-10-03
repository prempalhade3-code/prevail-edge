#include "PrevailVehiclePawn.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "PrevailGeo.h"
#include "PrevailLiveSubsystem.h"
#include "UObject/ConstructorHelpers.h"

APrevailVehiclePawn::APrevailVehiclePawn()
{
	PrimaryActorTick.bCanEverTick = true;

	Body = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Body"));
	SetRootComponent(Body);
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
	if (Cube.Succeeded())
	{
		Body->SetStaticMesh(Cube.Object);
	}
	Body->SetWorldScale3D(FVector(4.5f, 2.0f, 1.2f));
	Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	SpringArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("SpringArm"));
	SpringArm->SetupAttachment(Body);
	SpringArm->TargetArmLength = 620.0f;
	SpringArm->SocketOffset = FVector(0.0f, 220.0f, 160.0f);
	SpringArm->bDoCollisionTest = false;
	SpringArm->bUsePawnControlRotation = false;
	SpringArm->bInheritPitch = false;
	SpringArm->bInheritRoll = false;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(SpringArm);
	Camera->SetFieldOfView(52.0f);
}

void APrevailVehiclePawn::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	FollowSnapshot(DeltaSeconds);
}

void APrevailVehiclePawn::FollowSnapshot(float DeltaSeconds)
{
	const UGameInstance* GI = GetGameInstance();
	if (!GI)
	{
		return;
	}
	const UPrevailLiveSubsystem* Live = GI->GetSubsystem<UPrevailLiveSubsystem>();
	if (!Live || !Live->Latest.bHasVehicle)
	{
		return;
	}

	const FVector Gps = PrevailGeo::LatLonToUnreal(Live->Latest.VehicleLatitude, Live->Latest.VehicleLongitude);
	const float Yaw = PrevailGeo::HeadingToYaw(Live->Latest.VehicleHeading);
	const float SpeedCm = static_cast<float>(Live->Latest.VehicleSpeedMps * 100.0);

	if (!bHasGoal)
	{
		Goal = Gps;
		GoalYaw = Yaw;
		SetActorLocation(Gps);
		SetActorRotation(FRotator(0.0f, Yaw, 0.0f));
		bHasGoal = true;
		return;
	}

	const FVector Delta = Gps - Goal;
	if (Delta.Size() > 8.0f)
	{
		const FVector Dir = Delta.GetSafeNormal();
		const FVector Forward = GetActorForwardVector();
		if (FVector::DotProduct(Forward, Dir) > -0.2f || SpeedCm < 50.0f)
		{
			Goal = Gps;
			GoalYaw = Yaw;
			VelocityCm = Dir * SpeedCm;
		}
	}
	else if (SpeedCm > 30.0f)
	{
		VelocityCm = FRotator(0.0f, GoalYaw, 0.0f).Vector() * SpeedCm;
	}

	const FVector Predicted = Goal + VelocityCm * FMath::Min(DeltaSeconds + 0.08f, 0.25f);
	const FVector Next = FMath::VInterpTo(GetActorLocation(), Predicted, DeltaSeconds, 9.0f);
	const FRotator NextRot = FMath::RInterpTo(GetActorRotation(), FRotator(0.0f, GoalYaw, 0.0f), DeltaSeconds, 7.0f);
	SetActorLocation(Next);
	SetActorRotation(NextRot);
}
