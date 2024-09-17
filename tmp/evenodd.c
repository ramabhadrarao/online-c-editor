#include<stdio.h>
int main() {
    int num;
    printf("Enter Any Positive Number");
    scanf("%d",&num);
    if(num%2==0) {
        printf("The Number %d is Even",num);
    }
    else {
        printf("The Number %d is Odd",num);
    }
    return 0;
}