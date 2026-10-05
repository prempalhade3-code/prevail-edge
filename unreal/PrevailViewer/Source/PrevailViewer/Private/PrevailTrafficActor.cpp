#include "PrevailTrafficActor.h"
#include "PrevailMaterials.h"

APrevailTrafficActor::APrevailTrafficActor()
{
	PrimaryActorTick.bCanEverTick = true;

	USceneComponent* Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);

	Body = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Body"));
	Body->SetupAttachment(Root);
	if (UStaticMesh* Cube = PrevailCube())
	{
		Body->SetStaticMesh(Cube);
	}
	Body->SetRelativeLocation(FVector(0.0f, 0.0f, 58.0f));
	Body->SetRelativeScale3D(FVector(4.1f, 1.85f, 0.78f));
	Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	Cabin = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Cabin"));
	Cabin->SetupAttachment(Root);
	if (UStaticMesh* Cube = PrevailCube())
	{
		Cabin->SetStaticMesh(Cube);
	}
	Cabin->SetRelativeLocation(FVector(-35.0f, 0.0f, 108.0f));
	Cabin->SetRelativeScale3D(FVector(1.6f, 1.55f, 0.62f));
	Cabin->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void APrevailTrafficActor::SetPaint(const FLinearColor& Color)
{
	if (bPainted)
	{
		return;
	}
	if (UMaterialInstanceDynamic* Paint = PrevailMakeColor(this, Color))
	{
		Body->SetMaterial(0, Paint);
	}
	if (UMaterialInstanceDynamic* Glass = PrevailMakeColor(this, FLinearColor(0.06f, 0.07f, 0.09f)))
	{
		Cabin->SetMaterial(0, Glass);
	}
	bPainted = true;
}

void APrevailTrafficActor::SetTarget(const FVector& Location, float YawDeg, double SpeedMps)
{
	Tracker.SetTarget(Location, YawDeg, SpeedMps);
}

void APrevailTrafficActor::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!Tracker.IsReady())
	{
		return;
	}
	FVector Next;
	float Yaw = 0.0f;
	Tracker.Sample(DeltaSeconds, Next, Yaw);
	SetActorLocationAndRotation(Next, FRotator(0.0f, Yaw, 0.0f));
}
