#include "PrevailVehiclePawn.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "PrevailGeo.h"
#include "PrevailLiveSubsystem.h"
#include "PrevailMaterials.h"

APrevailVehiclePawn::APrevailVehiclePawn()
{
	PrimaryActorTick.bCanEverTick = true;

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);

	UStaticMesh* Cube = PrevailCube();
	UStaticMesh* Cylinder = PrevailCylinder();
	Body = MakePart(TEXT("Body"), Cube, FVector(0.0f, 0.0f, 62.0f), FVector(4.5f, 2.0f, 0.7f));
	Cabin = MakePart(TEXT("Cabin"), Cube, FVector(-40.0f, 0.0f, 118.0f), FVector(1.7f, 1.7f, 0.7f));
	Nose = MakePart(TEXT("Nose"), Cube, FVector(170.0f, 0.0f, 52.0f), FVector(1.3f, 1.7f, 0.42f));
	WheelFL = MakePart(TEXT("WheelFL"), Cylinder, FVector(145.0f, 95.0f, 32.0f), FVector(0.64f, 0.64f, 0.22f));
	WheelFR = MakePart(TEXT("WheelFR"), Cylinder, FVector(145.0f, -95.0f, 32.0f), FVector(0.64f, 0.64f, 0.22f));
	WheelRL = MakePart(TEXT("WheelRL"), Cylinder, FVector(-155.0f, 95.0f, 32.0f), FVector(0.64f, 0.64f, 0.22f));
	WheelRR = MakePart(TEXT("WheelRR"), Cylinder, FVector(-155.0f, -95.0f, 32.0f), FVector(0.64f, 0.64f, 0.22f));
	WheelFL->SetRelativeRotation(FRotator(0.0f, 0.0f, 90.0f));
	WheelFR->SetRelativeRotation(FRotator(0.0f, 0.0f, 90.0f));
	WheelRL->SetRelativeRotation(FRotator(0.0f, 0.0f, 90.0f));
	WheelRR->SetRelativeRotation(FRotator(0.0f, 0.0f, 90.0f));

	SpringArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("SpringArm"));
	SpringArm->SetupAttachment(Root);
	SpringArm->TargetArmLength = 920.0f;
	SpringArm->SocketOffset = FVector(40.0f, 40.0f, 210.0f);
	SpringArm->SetRelativeRotation(FRotator(-11.0f, 0.0f, 0.0f));
	SpringArm->bDoCollisionTest = false;
	SpringArm->bUsePawnControlRotation = false;
	SpringArm->bInheritPitch = false;
	SpringArm->bInheritRoll = false;
	SpringArm->bEnableCameraLag = true;
	SpringArm->CameraLagSpeed = 9.0f;
	SpringArm->bEnableCameraRotationLag = true;
	SpringArm->CameraRotationLagSpeed = 7.0f;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(SpringArm);
	Camera->SetFieldOfView(46.0f);
}

UStaticMeshComponent* APrevailVehiclePawn::MakePart(
	const FName& Name, UStaticMesh* Mesh, const FVector& Location, const FVector& Scale)
{
	UStaticMeshComponent* Part = CreateDefaultSubobject<UStaticMeshComponent>(Name);
	Part->SetupAttachment(Root);
	if (Mesh)
	{
		Part->SetStaticMesh(Mesh);
	}
	Part->SetRelativeLocation(Location);
	Part->SetRelativeScale3D(Scale);
	Part->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	return Part;
}

void APrevailVehiclePawn::BeginPlay()
{
	Super::BeginPlay();
	ApplyPaint();
	SnapToCorridorStart();
}

void APrevailVehiclePawn::SnapToCorridorStart()
{
	const UGameInstance* GI = GetGameInstance();
	const UPrevailLiveSubsystem* Live = GI ? GI->GetSubsystem<UPrevailLiveSubsystem>() : nullptr;
	if (Live && Live->Latest.bHasVehicle)
	{
		const FVector Gps = PrevailGeo::LatLonToUnreal(Live->Latest.VehicleLatitude, Live->Latest.VehicleLongitude, 40.0);
		SetActorLocation(Gps);
		SetActorRotation(FRotator(0.0f, PrevailGeo::HeadingToYaw(Live->Latest.VehicleHeading), 0.0f));
		Tracker.SetTarget(Gps, PrevailGeo::HeadingToYaw(Live->Latest.VehicleHeading), Live->Latest.VehicleSpeedMps);
		return;
	}
	// ORR corridor bootstrap point near edge-a until the first /v1/live packet lands.
	const FVector Start = PrevailGeo::LatLonToUnreal(12.920709, 77.663605, 40.0);
	SetActorLocation(Start);
}

void APrevailVehiclePawn::ApplyPaint()
{
	if (UMaterialInstanceDynamic* Paint = PrevailMakeColor(this, FLinearColor(0.78f, 0.04f, 0.07f)))
	{
		Body->SetMaterial(0, Paint);
		Nose->SetMaterial(0, Paint);
	}
	if (UMaterialInstanceDynamic* Glass = PrevailMakeColor(this, FLinearColor(0.05f, 0.06f, 0.08f)))
	{
		Cabin->SetMaterial(0, Glass);
	}
	if (UMaterialInstanceDynamic* Rubber = PrevailMakeColor(this, FLinearColor(0.03f, 0.03f, 0.03f)))
	{
		WheelFL->SetMaterial(0, Rubber);
		WheelFR->SetMaterial(0, Rubber);
		WheelRL->SetMaterial(0, Rubber);
		WheelRR->SetMaterial(0, Rubber);
	}
}

void APrevailVehiclePawn::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	FollowSnapshot(DeltaSeconds);
	SpinWheels(DeltaSeconds);
}

void APrevailVehiclePawn::FollowSnapshot(float DeltaSeconds)
{
	const UGameInstance* GI = GetGameInstance();
	const UPrevailLiveSubsystem* Live = GI ? GI->GetSubsystem<UPrevailLiveSubsystem>() : nullptr;
	if (!Live || !Live->Latest.bHasVehicle)
	{
		return;
	}

	const FVector Gps = PrevailGeo::LatLonToUnreal(Live->Latest.VehicleLatitude, Live->Latest.VehicleLongitude, 0.0);
	Tracker.SetTarget(Gps, PrevailGeo::HeadingToYaw(Live->Latest.VehicleHeading), Live->Latest.VehicleSpeedMps);

	FVector Next;
	float NextYaw = 0.0f;
	Tracker.Sample(DeltaSeconds, Next, NextYaw);
	SetActorLocation(Next);
	SetActorRotation(FRotator(0.0f, NextYaw, 0.0f));
}

void APrevailVehiclePawn::SpinWheels(float DeltaSeconds)
{
	if (Tracker.SpeedCmS < 5.0f)
	{
		return;
	}
	WheelSpin = FMath::UnwindDegrees(WheelSpin + FMath::RadiansToDegrees(Tracker.SpeedCmS / 32.0f) * DeltaSeconds);
	const FRotator Spin(WheelSpin, 0.0f, 90.0f);
	WheelFL->SetRelativeRotation(Spin);
	WheelFR->SetRelativeRotation(Spin);
	WheelRL->SetRelativeRotation(Spin);
	WheelRR->SetRelativeRotation(Spin);
}
